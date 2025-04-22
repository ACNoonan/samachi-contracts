use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Mint, Transfer};

// TODO: Replace with your actual program ID after first build/deploy
declare_id!("BAxhgSfwjWh5z6SMU6kVvgdEAkmqbipWeCKVuG4xMYFF"); 

#[program]
pub mod samachi_staking {
    use super::*;

    pub fn initialize_user(ctx: Context<InitializeUser>) -> Result<()> {
        let user_state = &mut ctx.accounts.user_state;
        user_state.authority = *ctx.accounts.authority.key;
        user_state.staked_amount = 0;
        user_state.bump = ctx.bumps.user_state; // Store the bump seed
        msg!("UserState account created for authority: {}", user_state.authority);
        msg!("Bump: {}", user_state.bump);
        Ok(())
    }

    pub fn initialize_vault(ctx: Context<InitializeVault>) -> Result<()> {
        msg!("Vault initialized for token mint: {}", ctx.accounts.mint.key());
        Ok(())
    }

    pub fn initialize_admin(ctx: Context<InitializeAdmin>) -> Result<()> {
        msg!("Admin initialized: {}", ctx.accounts.admin_authority.key());
        Ok(())
    }

    pub fn stake(ctx: Context<Stake>, amount: u64) -> Result<()> {
        let user_state = &mut ctx.accounts.user_state;

        // Transfer tokens from user to vault
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.user_token_account.to_account_info(),
                    to: ctx.accounts.vault_token_account.to_account_info(),
                    authority: ctx.accounts.authority.to_account_info(),
                },
            ),
            amount,
        )?;

        // Update state
        user_state.staked_amount = user_state.staked_amount.checked_add(amount)
            .ok_or(StakingError::MathOverflow)?;

        msg!("Staked {} tokens for user {}", amount, user_state.authority);
        msg!("New staked amount: {}", user_state.staked_amount);
        
        Ok(())
    }

    pub fn unstake(ctx: Context<Unstake>, amount: u64) -> Result<()> {
        let user_state = &mut ctx.accounts.user_state;

        // Verify user has enough staked
        require!(
            user_state.staked_amount >= amount,
            StakingError::InsufficientStake
        );

        // Transfer tokens from vault to user
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.vault_token_account.to_account_info(),
                    to: ctx.accounts.user_token_account.to_account_info(),
                    authority: ctx.accounts.vault_token_account.to_account_info(),
                },
                &[&[
                    VAULT_SEED,
                    ctx.accounts.mint.key().as_ref(),
                    &[ctx.bumps.vault_token_account],
                ]],
            ),
            amount,
        )?;

        // Update state
        user_state.staked_amount = user_state.staked_amount.checked_sub(amount)
            .ok_or(StakingError::MathOverflow)?;

        msg!("Unstaked {} tokens for user {}", amount, user_state.authority);
        msg!("New staked amount: {}", user_state.staked_amount);

        Ok(())
    }

    pub fn settle_bill(ctx: Context<SettleBill>, amount: u64) -> Result<()> {
        let user_state = &mut ctx.accounts.user_state;

        // Verify admin authority
        require!(
            ctx.accounts.admin.key() == ctx.accounts.admin_authority.key(),
            StakingError::Unauthorized
        );

        // Verify user has enough staked to cover the bill
        require!(
            user_state.staked_amount >= amount,
            StakingError::InsufficientStake
        );

        // Transfer tokens from vault to admin's treasury
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.vault_token_account.to_account_info(),
                    to: ctx.accounts.treasury_token_account.to_account_info(),
                    authority: ctx.accounts.vault_token_account.to_account_info(),
                },
                &[&[
                    VAULT_SEED,
                    ctx.accounts.mint.key().as_ref(),
                    &[ctx.bumps.vault_token_account],
                ]],
            ),
            amount,
        )?;

        // Update user's staked amount
        user_state.staked_amount = user_state.staked_amount.checked_sub(amount)
            .ok_or(StakingError::MathOverflow)?;

        msg!("Settled bill of {} tokens for user {}", amount, user_state.authority);
        msg!("New staked amount: {}", user_state.staked_amount);

        Ok(())
    }

    // pub fn check_in(ctx: Context<CheckIn>) -> Result<()> { Ok(()) }
    // pub fn record_spending(ctx: Context<RecordSpending>, amount: u64) -> Result<()> { Ok(()) }
    // pub fn settle_credit(ctx: Context<SettleCredit>) -> Result<()> { Ok(()) }
}

// Constants
const USER_SEED: &[u8] = b"user";
const VAULT_SEED: &[u8] = b"vault";
const ADMIN_SEED: &[u8] = b"admin";

#[account]
#[derive(Default)]
pub struct UserState {
    pub authority: Pubkey,          // User's wallet
    pub staked_amount: u64,         // Amount of USDC staked
    pub bump: u8,                   // Bump for this UserState PDA
}

impl UserState {
    // Define the space needed for the account
    pub const SPACE: usize = 8 // Discriminator
        + 32 // authority: Pubkey
        + 8 // staked_amount: u64
        + 1; // bump: u8
        // Total: 49 bytes
}

// Account validation structs
#[derive(Accounts)]
pub struct InitializeUser<'info> {
    #[account(
        init,
        payer = authority,
        space = UserState::SPACE,
        seeds = [USER_SEED, authority.key().as_ref()],
        bump
    )]
    pub user_state: Account<'info, UserState>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct InitializeVault<'info> {
    #[account(
        init,
        payer = payer,
        token::mint = mint,
        token::authority = vault_token_account, // The PDA itself is its own authority
        seeds = [VAULT_SEED, mint.key().as_ref()],
        bump
    )]
    pub vault_token_account: Account<'info, TokenAccount>,

    pub mint: Account<'info, Mint>,

    #[account(mut)]
    pub payer: Signer<'info>,

    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct InitializeAdmin<'info> {
    /// CHECK: This is the admin PDA that will be initialized
    #[account(
        init,
        payer = admin_authority,
        seeds = [ADMIN_SEED],
        bump,
        space = 8 // Just needs discriminator
    )]
    pub admin: AccountInfo<'info>,

    #[account(mut)]
    pub admin_authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Stake<'info> {
    #[account(
        mut,
        seeds = [USER_SEED, authority.key().as_ref()],
        bump = user_state.bump,
    )]
    pub user_state: Account<'info, UserState>,

    #[account(
        mut,
        token::mint = mint,
        token::authority = authority
    )]
    pub user_token_account: Account<'info, TokenAccount>,

    #[account(
        mut,
        seeds = [VAULT_SEED, mint.key().as_ref()],
        bump,
    )]
    pub vault_token_account: Account<'info, TokenAccount>,

    pub mint: Account<'info, Mint>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct Unstake<'info> {
    #[account(
        mut,
        seeds = [USER_SEED, authority.key().as_ref()],
        bump = user_state.bump,
    )]
    pub user_state: Account<'info, UserState>,

    #[account(
        mut,
        token::mint = mint,
        token::authority = authority
    )]
    pub user_token_account: Account<'info, TokenAccount>,

    #[account(
        mut,
        seeds = [VAULT_SEED, mint.key().as_ref()],
        bump,
    )]
    pub vault_token_account: Account<'info, TokenAccount>,

    pub mint: Account<'info, Mint>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct SettleBill<'info> {
    #[account(
        mut,
        seeds = [USER_SEED, user_state.authority.key().as_ref()],
        bump = user_state.bump,
    )]
    pub user_state: Account<'info, UserState>,

    #[account(
        mut,
        seeds = [VAULT_SEED, mint.key().as_ref()],
        bump,
    )]
    pub vault_token_account: Account<'info, TokenAccount>,

    #[account(
        mut,
        token::mint = mint,
        token::authority = admin_authority
    )]
    pub treasury_token_account: Account<'info, TokenAccount>,

    pub mint: Account<'info, Mint>,

    /// CHECK: This is the admin PDA that authorizes settlements
    #[account(
        seeds = [ADMIN_SEED],
        bump,
    )]
    pub admin: AccountInfo<'info>,

    #[account(mut)]
    pub admin_authority: Signer<'info>,

    pub token_program: Program<'info, Token>,
}

// Custom Errors
#[error_code]
pub enum StakingError {
    #[msg("Insufficient stake for withdrawal.")]
    InsufficientStake,
    #[msg("Math operation overflow.")]
    MathOverflow,
    #[msg("Unauthorized admin.")]
    Unauthorized,
    // Add other errors as needed
}
