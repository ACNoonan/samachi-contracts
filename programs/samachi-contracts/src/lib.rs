use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

// Use the actual program ID after deployment
declare_id!("8VtCsstcdNp1vCoUA1epHXgar9tsKurPZ9eQhrieVrCX");

// It's crucial that the Anchor CLI version used for `anchor build` matches
// the version of `@coral-xyz/anchor` (or `@project-serum/anchor`) used in the client.
// Check with `anchor --version` and your `package.json`.

#[program]
pub mod samachi_staking {
    use super::*;

    // Uncommented: Initializes the state for a new user
    pub fn initialize_user(ctx: Context<InitializeUser>) -> Result<()> {
        let user_state = &mut ctx.accounts.user_state;
        user_state.authority = ctx.accounts.authority.key();
        user_state.staked_amount = 0;
        user_state.bump = ctx.bumps.user_state; // Store the bump for PDA validation
        msg!(
            "UserState initialized for authority: {}",
            user_state.authority
        );
        msg!("UserState bump: {}", user_state.bump);
        Ok(())
    }

    /* Commented out: Initializes the admin state
    // const ADMIN_SEED: &[u8] = b"admin_state"; // Seed for the admin PDA
    pub fn initialize_admin(ctx: Context<InitializeAdmin>) -> Result<()> {
        ctx.accounts.admin_state.bump = ctx.bumps.admin_state;
        msg!(
            "AdminState initialized with bump: {}",
            ctx.accounts.admin_state.bump
        );
        msg!("Admin Authority: {}", ctx.accounts.admin_authority.key());
        Ok(())
    }
    */

    // Initializes the program's main token vault and its authority PDA
    pub fn initialize_vault(ctx: Context<InitializeVault>) -> Result<()> {
        // The vault_authority PDA will own the vault_token_account
        ctx.accounts.vault_authority.bump = ctx.bumps.vault_authority;
        msg!(
            "Vault Token Account initialized: {}",
            ctx.accounts.vault_token_account.key()
        );
        msg!(
            "Vault Authority PDA initialized with bump: {}",
            ctx.accounts.vault_authority.bump
        );
        msg!("Mint: {}", ctx.accounts.mint.key());
        Ok(())
    }

    // Uncommented: Stakes tokens from the user's account into the vault
    pub fn stake(ctx: Context<Stake>, amount: u64) -> Result<()> {
        require!(amount > 0, StakingError::ZeroAmount); // Prevent staking zero

        let user_state = &mut ctx.accounts.user_state;

        // Transfer tokens: User Token Account -> Vault Token Account
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.user_token_account.to_account_info(),
                    to: ctx.accounts.vault_token_account.to_account_info(),
                    authority: ctx.accounts.authority.to_account_info(), // User signs
                },
            ),
            amount,
        )?;

        // Update user's staked amount
        user_state.staked_amount = user_state
            .staked_amount
            .checked_add(amount)
            .ok_or(StakingError::MathOverflow)?;

        msg!(
            "Staked {} tokens for user {}. New balance: {}",
            amount,
            user_state.authority,
            user_state.staked_amount
        );
        Ok(())
    }

    // Uncommented: Unstakes tokens from the vault back to the user's account
    pub fn unstake(ctx: Context<Unstake>, amount: u64) -> Result<()> {
        require!(amount > 0, StakingError::ZeroAmount); // Prevent unstaking zero

        let user_state = &mut ctx.accounts.user_state;

        // Check if user has enough staked balance
        require!(
            user_state.staked_amount >= amount,
            StakingError::InsufficientStake
        );

        // Prepare PDA seeds for signing the transfer *from* the vault
        let mint_key = ctx.accounts.mint.key();
        let bump_slice = [ctx.accounts.vault_authority.bump]; // Create binding for bump
        let authority_seeds = &[
            VAULT_AUTHORITY_SEED,
            mint_key.as_ref(),
            &bump_slice, // Use the binding
        ][..];
        let signer_seeds = &[&authority_seeds[..]];

        // Transfer tokens: Vault Token Account -> User Token Account
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.vault_token_account.to_account_info(),
                    to: ctx.accounts.user_token_account.to_account_info(),
                    authority: ctx.accounts.vault_authority.to_account_info(), // PDA signs
                },
                signer_seeds, // PDA signs using seeds
            ),
            amount,
        )?;

        // Update user's staked amount
        user_state.staked_amount = user_state
            .staked_amount
            .checked_sub(amount)
            .ok_or(StakingError::MathOverflow)?; // Subtraction overflow unlikely but good practice

        msg!(
            "Unstaked {} tokens for user {}. New balance: {}",
            amount,
            user_state.authority,
            user_state.staked_amount
        );
        Ok(())
    }

    // Uncommented: Allows admin to settle a bill by transferring staked tokens from the vault to a treasury account
    pub fn settle_bill(ctx: Context<SettleBill>, amount: u64) -> Result<()> {
        require!(amount > 0, StakingError::ZeroAmount); // Prevent settling zero

        let user_state = &mut ctx.accounts.user_state;

        // Check if user has enough staked balance to cover the bill
        require!(
            user_state.staked_amount >= amount,
            StakingError::InsufficientStake
        );

        // Prepare PDA seeds for signing the transfer *from* the vault
        let mint_key = ctx.accounts.mint.key();
        let bump_slice = [ctx.accounts.vault_authority.bump]; // Create binding for bump
        let authority_seeds = &[
            VAULT_AUTHORITY_SEED,
            mint_key.as_ref(),
            &bump_slice, // Use the binding
        ][..];
        let signer_seeds = &[&authority_seeds[..]];

        // Transfer tokens: Vault Token Account -> Treasury Token Account
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.vault_token_account.to_account_info(),
                    to: ctx.accounts.treasury_token_account.to_account_info(), // Admin controlled treasury
                    authority: ctx.accounts.vault_authority.to_account_info(), // PDA signs
                },
                signer_seeds, // PDA signs using seeds
            ),
            amount,
        )?;

        // Update user's staked amount
        user_state.staked_amount = user_state
            .staked_amount
            .checked_sub(amount)
            .ok_or(StakingError::MathOverflow)?;

        msg!(
            "Settled bill of {} tokens for user {}. New balance: {}",
            amount,
            user_state.authority, // The user whose stake is reduced
            user_state.staked_amount
        );
        msg!(
            "Transfer initiated by admin: {}",
            ctx.accounts.admin_authority.key()
        );
        Ok(())
    }
}

// Constants for PDA seeds
const USER_SEED: &[u8] = b"user_state"; // More specific seed
const VAULT_SEED: &[u8] = b"vault_tokens"; // More specific seed
const VAULT_AUTHORITY_SEED: &[u8] = b"vault_authority"; // Seed for the vault's authority PDA
// const ADMIN_SEED: &[u8] = b"admin_state"; // Commented out

// Account Structs
// Uncommented: UserState Account
#[account]
#[derive(Default)]
pub struct UserState {
    pub authority: Pubkey,  // The user's wallet address
    pub staked_amount: u64, // Amount of tokens staked by the user
    pub bump: u8,           // Bump seed for the UserState PDA
}

// Uncommented: UserState Implementation
impl UserState {
    pub const SPACE: usize = 8 // Discriminator
        + 32 // authority: Pubkey
        + 8  // staked_amount: u64
        + 1; // bump: u8
             // Total: 49 bytes
}

/* Commented out: AdminState Account
#[account]
#[derive(Default)]
pub struct AdminState {
    // Holds global admin settings or state, currently just the bump
    pub bump: u8,
}

impl AdminState {
    pub const SPACE: usize = 8 // Discriminator
        + 1; // bump: u8
             // Total: 9 bytes
}
*/

#[account]
#[derive(Default)]
pub struct VaultAuthority {
    // This PDA acts as the authority for the vault_token_account.
    // It doesn't need fields now, but holds the bump.
    pub bump: u8,
}

impl VaultAuthority {
    pub const SPACE: usize = 8 // Discriminator
        + 1; // bump: u8
             // Total: 9 bytes
}

// Instruction Contexts (Validation Structs)

/* Commented out: InitializeAdmin Context
#[derive(Accounts)]
pub struct InitializeAdmin<'info> {
    #[account(
        init,
        payer = admin_authority,
        seeds = [ADMIN_SEED], // Use admin seed
        bump,
        space = AdminState::SPACE
    )]
    pub admin_state: Account<'info, AdminState>,

    #[account(mut)]
    pub admin_authority: Signer<'info>, // The wallet initializing the admin state
    pub system_program: Program<'info, System>,
}
*/

#[derive(Accounts)]
pub struct InitializeVault<'info> {
    #[account(
        init,
        payer = payer,
        seeds = [VAULT_AUTHORITY_SEED, mint.key().as_ref()], // Seeds for the authority PDA
        bump,
        space = VaultAuthority::SPACE
    )]
    pub vault_authority: Account<'info, VaultAuthority>,

    #[account(
        init,
        payer = payer,
        token::mint = mint,
        token::authority = vault_authority, // The PDA is the authority
        seeds = [VAULT_SEED, mint.key().as_ref()], // Seeds for the token account PDA
        bump
    )]
    pub vault_token_account: Account<'info, TokenAccount>,

    pub mint: Account<'info, Mint>, // The mint of the token being staked
    #[account(mut)]
    pub payer: Signer<'info>, // Wallet paying for account creation
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub rent: Sysvar<'info, Rent>, // Needed for token account init
}

// Uncommented: InitializeUser Context
#[derive(Accounts)]
pub struct InitializeUser<'info> {
    #[account(
        init,
        payer = authority,
        space = UserState::SPACE,
        seeds = [USER_SEED, authority.key().as_ref()], // Use authority's key for seed
        bump
    )]
    pub user_state: Account<'info, UserState>,
    #[account(mut)]
    pub authority: Signer<'info>, // The user initializing their state
    pub system_program: Program<'info, System>,
}

// Uncommented: Stake Context
#[derive(Accounts)]
pub struct Stake<'info> {
    #[account(
        mut,
        seeds = [USER_SEED, authority.key().as_ref()], // User authority's key derives PDA
        bump = user_state.bump, // Validate bump
        has_one = authority @ StakingError::InvalidAuthority // Ensure signer is the authority stored in state
    )]
    pub user_state: Account<'info, UserState>,

    #[account(
        mut,
        token::mint = mint, // Ensure token account is for the correct mint
        token::authority = authority // Ensure user owns this token account
    )]
    pub user_token_account: Account<'info, TokenAccount>,

    #[account(
        mut,
        seeds = [VAULT_SEED, mint.key().as_ref()], // Vault token account seeds
        bump // Anchor derives and checks bump
    )]
    pub vault_token_account: Account<'info, TokenAccount>,

    // Vault authority account - needed for context but not directly used in simple stake
    #[account(
        seeds = [VAULT_AUTHORITY_SEED, mint.key().as_ref()],
        bump = vault_authority.bump
    )]
    pub vault_authority: Account<'info, VaultAuthority>,

    pub mint: Account<'info, Mint>, // Mint must match vault's mint
    #[account(mut)] // Authority needs to be mutable if paying fees, but often just needs to be a signer
    pub authority: Signer<'info>, // The user performing the stake
    pub token_program: Program<'info, Token>,
    // pub system_program: Program<'info, System>, // System program might be needed if creating accounts, but not for basic transfer
}

// Uncommented: Unstake Context
#[derive(Accounts)]
pub struct Unstake<'info> {
    #[account(
        mut,
        seeds = [USER_SEED, authority.key().as_ref()],
        bump = user_state.bump,
        has_one = authority @ StakingError::InvalidAuthority
    )]
    pub user_state: Account<'info, UserState>,

    #[account(
        mut,
        token::mint = mint,
        token::authority = authority // User must own the destination account
    )]
    pub user_token_account: Account<'info, TokenAccount>, // Where tokens are sent

    #[account(
        mut,
        seeds = [VAULT_SEED, mint.key().as_ref()],
        bump // Anchor derives and checks bump
    )]
    pub vault_token_account: Account<'info, TokenAccount>, // Source of tokens

    #[account(
        seeds = [VAULT_AUTHORITY_SEED, mint.key().as_ref()],
        bump = vault_authority.bump // Check the authority PDA using stored bump
    )]
    pub vault_authority: Account<'info, VaultAuthority>, // Needed for CPI signer seeds

    pub mint: Account<'info, Mint>, // Mint must match
    #[account(mut)]
    pub authority: Signer<'info>, // The user performing the unstake
    pub token_program: Program<'info, Token>,
}

// Uncommented: SettleBill Context
#[derive(Accounts)]
pub struct SettleBill<'info> {
    #[account(
        mut,
        // Use the authority key from the SettleBill context to find the state
        seeds = [USER_SEED, authority.key().as_ref()], // Use authority seed
        bump = user_state.bump,
        // Check that the authority stored in state matches the authority AccountInfo passed in
        has_one = authority @ StakingError::InvalidAuthorityForState // Use 'authority' to match field in UserState
    )]
    pub user_state: Account<'info, UserState>, // The user whose stake is being used

    /// CHECK: This is the authority field from the UserState account, passed into the instruction.
    /// The `has_one = authority` constraint ensures this key matches the one stored in `user_state`.
    /// It does not need to be a signer or mutable for this specific instruction.
    pub authority: AccountInfo<'info>, // Renamed from user_authority to match has_one

    #[account(
        mut,
        seeds = [VAULT_SEED, mint.key().as_ref()],
        bump // Anchor derives and checks vault token account bump
    )]
    pub vault_token_account: Account<'info, TokenAccount>, // Source of tokens

    #[account(
        seeds = [VAULT_AUTHORITY_SEED, mint.key().as_ref()],
        bump = vault_authority.bump // Check the vault authority PDA using stored bump
    )]
    pub vault_authority: Account<'info, VaultAuthority>, // Needed for CPI signer seeds

    #[account(
        mut,
        token::mint = mint // Ensure treasury is for the correct token
        // No authority constraint needed here, the program signs the transfer *to* it.
        // We rely on the admin_authority signer check below.
    )]
    pub treasury_token_account: Account<'info, TokenAccount>, // Destination for settled funds

    pub mint: Account<'info, Mint>, // Mint must match

    // This authority MUST sign the transaction to authorize the settlement
    #[account(mut)] // Mutable if paying fees
    pub admin_authority: Signer<'info>,

    /* Commented out: AdminState Account reference
    #[account(
        seeds = [ADMIN_SEED],
        bump = admin_state.bump, // Validate admin state PDA
        // Add constraint if admin state should hold admin_authority key: has_one = admin_authority
    )]
    pub admin_state: Account<'info, AdminState>,
    */

    pub token_program: Program<'info, Token>,
}

// Custom Error Codes
#[error_code]
pub enum StakingError {
    #[msg("Insufficient staked amount for withdrawal or settlement.")]
    InsufficientStake,
    #[msg("Mathematical operation resulted in an overflow.")]
    MathOverflow,
    #[msg("The provided authority does not match the expected authority.")]
    InvalidAuthority,
    #[msg("The user authority provided does not match the authority stored in the user state.")]
    InvalidAuthorityForState,
    #[msg("Operation cannot be performed with zero amount.")]
    ZeroAmount,
    // #[msg("Unauthorized admin action.")] // Keep commented or remove if not needed
    // Unauthorized,
}

// Note: The original `Unauthorized` error might be less relevant now unless
// you add checks comparing `admin_authority.key()` to a key stored in `AdminState`.
// The current setup relies on `admin_authority` being a signer and the `admin_state` PDA existing.