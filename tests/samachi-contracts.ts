import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { SamachiStaking } from "../target/types/samachi_staking";
import { PublicKey, SystemProgram, SYSVAR_RENT_PUBKEY } from "@solana/web3.js";
import { createMint, getOrCreateAssociatedTokenAccount, getAssociatedTokenAddress, mintTo, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { assert } from "chai";

describe("samachi-staking", () => {
  // Configure the client to use the local cluster.
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.SamachiStaking as Program<SamachiStaking>;

  // Keypairs
  const admin = anchor.web3.Keypair.generate(); // Keep admin for potential future use or treasury owner
  const user = anchor.web3.Keypair.generate();
  const mintAuthority = anchor.web3.Keypair.generate();
  let usdcMint: PublicKey;

  // PDAs and bumps (using seeds from lib.rs)
  let userStatePDA: PublicKey;
  let userStateBump: number;
  let vaultAuthorityPDA: PublicKey;
  let vaultAuthorityBump: number;
  let vaultTokenAccountPDA: PublicKey;
  let vaultTokenAccountBump: number;
  // let adminStatePDA: PublicKey; // Commented out as initializeAdmin is inactive
  // let adminStateBump: number; // Commented out

  // Token accounts
  let userTokenAccountATA: PublicKey; // User's Associated Token Account
  let treasuryTokenAccountATA: PublicKey; // Admin's Associated Token Account for treasury

  // Constants from lib.rs
  const USER_SEED = Buffer.from("user_state");
  const VAULT_SEED = Buffer.from("vault_tokens");
  const VAULT_AUTHORITY_SEED = Buffer.from("vault_authority");
  // const ADMIN_SEED = Buffer.from("admin_state"); // Commented out

  before(async () => {
    // Airdrop SOL - Commented out due to rate limiting issues.
    // Ensure the admin, user, and mintAuthority accounts have SOL before running tests.
    /*
    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(admin.publicKey, 1000000000),
      "confirmed"
    );
    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(user.publicKey, 1000000000),
      "confirmed"
    );
    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(mintAuthority.publicKey, 1000000000),
      "confirmed"
    );
    */

    // Create USDC Mint
    usdcMint = await createMint(
      provider.connection,
      mintAuthority,
      mintAuthority.publicKey,
      null,
      6 // Decimals
    );
    console.log("USDC Mint:", usdcMint.toBase58());

    // Derive PDAs based on lib.rs seeds
    [userStatePDA, userStateBump] = PublicKey.findProgramAddressSync(
      [USER_SEED, user.publicKey.toBuffer()],
      program.programId
    );
    console.log("UserState PDA:", userStatePDA.toBase58());

    [vaultAuthorityPDA, vaultAuthorityBump] = PublicKey.findProgramAddressSync(
      [VAULT_AUTHORITY_SEED, usdcMint.toBuffer()],
      program.programId
    );
    console.log("Vault Authority PDA:", vaultAuthorityPDA.toBase58());

    [vaultTokenAccountPDA, vaultTokenAccountBump] = PublicKey.findProgramAddressSync(
      [VAULT_SEED, usdcMint.toBuffer()],
      program.programId
    );
    console.log("Vault Token Account PDA:", vaultTokenAccountPDA.toBase58());

    /* // Commented out Admin PDA derivation
    [adminStatePDA, adminStateBump] = PublicKey.findProgramAddressSync(
      [ADMIN_SEED],
      program.programId
    );
    console.log("AdminState PDA:", adminStatePDA.toBase58());
    */

    // Create User Associated Token Account
    const userTokenAccountInfo = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      user, // Payer
      usdcMint,
      user.publicKey, // Owner
      false // Allow owner off curve
    );
    userTokenAccountATA = userTokenAccountInfo.address;
    console.log("User ATA:", userTokenAccountATA.toBase58());

    // Create Treasury Associated Token Account (Owned by Admin)
    const treasuryTokenAccountInfo = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      admin, // Payer
      usdcMint,
      admin.publicKey, // Owner (admin controls treasury)
      false
    );
    treasuryTokenAccountATA = treasuryTokenAccountInfo.address;
    console.log("Treasury ATA:", treasuryTokenAccountATA.toBase58());

    // Mint tokens to user's ATA
    await mintTo(
      provider.connection,
      mintAuthority, // Payer/Signer
      usdcMint,
      userTokenAccountATA, // Destination
      mintAuthority, // Mint Authority
      1000 * 10 ** 6 // 1000 USDC (adjust amount as needed)
    );
    console.log("Minted 1000 USDC to user ATA");
    const initialUserBalance = await provider.connection.getTokenAccountBalance(userTokenAccountATA);
    console.log("Initial User ATA Balance:", initialUserBalance.value.uiAmountString);
  });

  /* // Instruction commented out in lib.rs
  it("Initializes admin", async () => {
    await program.methods
      .initializeAdmin()
      .accounts({
        adminState: adminStatePDA, // Use PDA derived above
        adminAuthority: admin.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([admin])
      .rpc();

    const adminState = await program.account.adminState.fetch(adminStatePDA);
    assert.equal(adminState.bump, adminStateBump);
    console.log("Admin initialized");
  });
  */

  it("Initializes user state", async () => {
    await program.methods
      .initializeUser()
      .accounts({
        userState: userStatePDA, // Use camelCase key matching the IDL
        authority: user.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([user])
      .rpc();

    // Verify user state
    const userState = await program.account.userState.fetch(userStatePDA);
    assert.isTrue(userState.authority.equals(user.publicKey));
    assert.isTrue(userState.stakedAmount.eqn(0));
    assert.equal(userState.bump, userStateBump);
    console.log("User state initialized for:", user.publicKey.toBase58());
  });


  it("Initializes vault", async () => {
    console.log("Initializing vault...");
    await program.methods
      .initializeVault()
      .accounts({
        vaultAuthority: vaultAuthorityPDA,     // Use camelCase key matching the IDL
        vaultTokenAccount: vaultTokenAccountPDA, // Use camelCase key matching the IDL
        mint: usdcMint,
        payer: user.publicKey,                 // User pays for initialization
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        rent: SYSVAR_RENT_PUBKEY,
      })
      // No signers needed if payer is the provider wallet or handled implicitly
      // If 'user' needs to sign for paying, add .signers([user])
      // Since payer is user.publicKey, user must sign
      .signers([user])
      .rpc();

    // Verify vault authority PDA data
    const vaultAuthorityState = await program.account.vaultAuthority.fetch(vaultAuthorityPDA);
    assert.equal(vaultAuthorityState.bump, vaultAuthorityBump);
    console.log("Vault Authority PDA Initialized");

    // Verify vault token account details
    const vaultTokenAccountInfo = await provider.connection.getAccountInfo(vaultTokenAccountPDA);
    // Check if account exists and is owned by token program
    assert.isNotNull(vaultTokenAccountInfo);
    assert.isTrue(vaultTokenAccountInfo.owner.equals(TOKEN_PROGRAM_ID));

    // A more detailed check using spl-token library if needed:
    // const vaultTokenAccountData = AccountLayout.decode(vaultTokenAccountInfo.data);
    // assert.isTrue(new PublicKey(vaultTokenAccountData.mint).equals(usdcMint));
    // assert.isTrue(new PublicKey(vaultTokenAccountData.owner).equals(vaultAuthorityPDA)); // PDA is the authority

    console.log("Vault Token Account PDA Initialized and owned by Token Program");
  });


  /* // Instruction commented out in lib.rs
  it("Stakes tokens", async () => {
    const amount = new anchor.BN(100 * 10 ** 6); // 100 USDC
    const userBalanceBefore = await provider.connection.getTokenAccountBalance(userTokenAccountATA);
    const vaultBalanceBefore = await provider.connection.getTokenAccountBalance(vaultTokenAccountPDA);

    await program.methods
      .stake(amount)
      .accounts({
        userState: userStatePDA,
        userTokenAccount: userTokenAccountATA,   // User's ATA
        vaultTokenAccount: vaultTokenAccountPDA, // Vault's PDA Token Account
        vaultAuthority: vaultAuthorityPDA,     // Added vault authority PDA
        mint: usdcMint,
        authority: user.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([user])
      .rpc();

    // Verify user state
    const userState = await program.account.userState.fetch(userStatePDA);
    assert.isTrue(userState.stakedAmount.eq(amount), "User state stake amount mismatch");

    // Verify token balances
    const userBalanceAfter = await provider.connection.getTokenAccountBalance(userTokenAccountATA);
    const vaultBalanceAfter = await provider.connection.getTokenAccountBalance(vaultTokenAccountPDA);

    const expectedUserBalance = new anchor.BN(userBalanceBefore.value.amount).sub(amount);
    const expectedVaultBalance = new anchor.BN(vaultBalanceBefore.value.amount).add(amount);

    assert.isTrue(new anchor.BN(userBalanceAfter.value.amount).eq(expectedUserBalance), "User ATA balance mismatch after stake");
    assert.isTrue(new anchor.BN(vaultBalanceAfter.value.amount).eq(expectedVaultBalance), "Vault Token Account balance mismatch after stake");

    console.log(`Staked ${amount.toString()} tokens`);
    console.log("User ATA Balance:", userBalanceAfter.value.uiAmountString);
    console.log("Vault PDA Balance:", vaultBalanceAfter.value.uiAmountString);
  });
  */

  /* // Instruction commented out in lib.rs
  it("Unstakes tokens", async () => {
    const userStateBefore = await program.account.userState.fetch(userStatePDA);
    const amountToUnstake = new anchor.BN(50 * 10 ** 6); // Unstake 50 USDC
    assert.isTrue(userStateBefore.stakedAmount.gte(amountToUnstake), "Not enough staked to unstake");

    const userBalanceBefore = await provider.connection.getTokenAccountBalance(userTokenAccountATA);
    const vaultBalanceBefore = await provider.connection.getTokenAccountBalance(vaultTokenAccountPDA);

    await program.methods
      .unstake(amountToUnstake)
      .accounts({
        userState: userStatePDA,
        userTokenAccount: userTokenAccountATA,   // User's ATA
        vaultTokenAccount: vaultTokenAccountPDA, // Vault's PDA Token Account
        vaultAuthority: vaultAuthorityPDA,     // Vault authority PDA (signer)
        mint: usdcMint,
        authority: user.publicKey,             // User (owner of userState)
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([user])
      .rpc();

    // Verify user state
    const userStateAfter = await program.account.userState.fetch(userStatePDA);
    const expectedStake = userStateBefore.stakedAmount.sub(amountToUnstake);
    assert.isTrue(userStateAfter.stakedAmount.eq(expectedStake), "User state stake amount mismatch after unstake");

    // Verify token balances
    const userBalanceAfter = await provider.connection.getTokenAccountBalance(userTokenAccountATA);
    const vaultBalanceAfter = await provider.connection.getTokenAccountBalance(vaultTokenAccountPDA);

    const expectedUserBalance = new anchor.BN(userBalanceBefore.value.amount).add(amountToUnstake);
    const expectedVaultBalance = new anchor.BN(vaultBalanceBefore.value.amount).sub(amountToUnstake);

    assert.isTrue(new anchor.BN(userBalanceAfter.value.amount).eq(expectedUserBalance), "User ATA balance mismatch after unstake");
    assert.isTrue(new anchor.BN(vaultBalanceAfter.value.amount).eq(expectedVaultBalance), "Vault Token Account balance mismatch after unstake");


    console.log(`Unstaked ${amountToUnstake.toString()} tokens`);
    console.log("User State Staked:", userStateAfter.stakedAmount.toString());
    console.log("User ATA Balance:", userBalanceAfter.value.uiAmountString);
    console.log("Vault PDA Balance:", vaultBalanceAfter.value.uiAmountString);
  });
  */

  /* // Instruction commented out in lib.rs
  it("Settles bill as admin", async () => {
    // Ensure user has enough stake (e.g., 50 USDC left from previous tests)
    const userStateBefore = await program.account.userState.fetch(userStatePDA);
    const amountToSettle = new anchor.BN(20 * 10 ** 6); // Settle 20 USDC
    assert.isTrue(userStateBefore.stakedAmount.gte(amountToSettle), "Not enough staked to settle bill");

    const vaultBalanceBefore = await provider.connection.getTokenAccountBalance(vaultTokenAccountPDA);
    const treasuryBalanceBefore = await provider.connection.getTokenAccountBalance(treasuryTokenAccountATA);


    await program.methods
      .settleBill(amountToSettle)
      .accounts({
        userState: userStatePDA,                 // User whose stake is used
        authority: user.publicKey,             // ** Authority stored in user_state **
        vaultTokenAccount: vaultTokenAccountPDA, // Source vault
        vaultAuthority: vaultAuthorityPDA,     // Vault authority PDA (signer)
        treasuryTokenAccount: treasuryTokenAccountATA, // Destination treasury
        mint: usdcMint,
        adminAuthority: admin.publicKey,       // Admin initiating settlement
        // adminState: adminStatePDA,          // Add if constraint is needed
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([admin]) // Admin signs to authorize
      .rpc();

    // Verify user state
    const userStateAfter = await program.account.userState.fetch(userStatePDA);
    const expectedStake = userStateBefore.stakedAmount.sub(amountToSettle);
    assert.isTrue(userStateAfter.stakedAmount.eq(expectedStake), "User state stake amount mismatch after settlement");

    // Verify token balances
    const vaultBalanceAfter = await provider.connection.getTokenAccountBalance(vaultTokenAccountPDA);
    const treasuryBalanceAfter = await provider.connection.getTokenAccountBalance(treasuryTokenAccountATA);

    const expectedVaultBalance = new anchor.BN(vaultBalanceBefore.value.amount).sub(amountToSettle);
    const expectedTreasuryBalance = new anchor.BN(treasuryBalanceBefore.value.amount).add(amountToSettle);

    assert.isTrue(new anchor.BN(vaultBalanceAfter.value.amount).eq(expectedVaultBalance), "Vault Token Account balance mismatch after settlement");
    assert.isTrue(new anchor.BN(treasuryBalanceAfter.value.amount).eq(expectedTreasuryBalance), "Treasury Token Account balance mismatch after settlement");


    console.log(`Settled bill of ${amountToSettle.toString()} tokens for user ${user.publicKey.toBase58()}`);
    console.log("User State Staked:", userStateAfter.stakedAmount.toString());
    console.log("Vault PDA Balance:", vaultBalanceAfter.value.uiAmountString);
    console.log("Treasury ATA Balance:", treasuryBalanceAfter.value.uiAmountString);
  });
  */
});

// Helper function to sleep (useful for waiting for transaction confirmation if needed)
// const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
