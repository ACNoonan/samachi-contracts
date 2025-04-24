import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { SamachiStaking } from "../target/types/samachi_staking";
import { PublicKey, SystemProgram, SYSVAR_RENT_PUBKEY } from "@solana/web3.js";
import { createMint, getOrCreateAssociatedTokenAccount, mintTo, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { assert } from "chai";

describe("samachi-staking", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.SamachiStaking as Program<SamachiStaking>;

  // Admin keypair
  const admin = anchor.web3.Keypair.generate();

  // User keypair
  const user = anchor.web3.Keypair.generate();

  // Mint keypair
  const mintAuthority = anchor.web3.Keypair.generate();
  let usdcMint: PublicKey;

  // PDA seeds
  let vaultPDA: PublicKey;
  let vaultBump: number;
  let userStatePDA: PublicKey;
  let userStateBump: number;
  let adminPDA: PublicKey;
  let adminBump: number;

  // Token accounts
  let userTokenAccount: PublicKey;
  let vaultTokenAccount: PublicKey;
  let treasuryTokenAccount: PublicKey;

  before(async () => {
    // Airdrop SOL to admin, user, and mint authority
    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(admin.publicKey, 1000000000)
    );
    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(user.publicKey, 1000000000)
    );
    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(mintAuthority.publicKey, 1000000000)
    );

    // Create test mint
    usdcMint = await createMint(
      provider.connection,
      mintAuthority,
      mintAuthority.publicKey,
      null,
      6 // 6 decimals like USDC
    );

    // Initialize PDAs
    [vaultPDA, vaultBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), usdcMint.toBuffer()],
      program.programId
    );

    [userStatePDA, userStateBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("user"), user.publicKey.toBuffer()],
      program.programId
    );

    [adminPDA, adminBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("admin")],
      program.programId
    );

    // Create token accounts
    const userTokenAccountInfo = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      user,
      usdcMint,
      user.publicKey
    );
    userTokenAccount = userTokenAccountInfo.address;

    // For vault, we'll let the program create the token account
    vaultTokenAccount = vaultPDA;

    const treasuryTokenAccountInfo = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      admin,
      usdcMint,
      admin.publicKey
    );
    treasuryTokenAccount = treasuryTokenAccountInfo.address;

    // Mint some tokens to user
    await mintTo(
      provider.connection,
      mintAuthority,
      usdcMint,
      userTokenAccount,
      mintAuthority,
      1000000 // 1 token (6 decimals)
    );
  });

  it("Initializes admin", async () => {
    await program.methods
      .initializeAdmin()
      .accounts({
        admin: adminPDA,
        adminAuthority: admin.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([admin])
      .rpc();
  });

  it("Initializes user", async () => {
    await program.methods
      .initializeUser()
      .accounts({
        userState: userStatePDA,
        authority: user.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([user])
      .rpc();
  });

  it("Initializes vault", async () => {
    await program.methods
      .initializeVault()
      .accounts({
        vaultTokenAccount: vaultTokenAccount,
        mint: usdcMint,
        payer: user.publicKey,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .signers([user])
      .rpc();
  });

  it("Stakes tokens", async () => {
    const amount = new anchor.BN(1000000); // 1 token
    await program.methods
      .stake(amount)
      .accounts({
        userState: userStatePDA,
        userTokenAccount: userTokenAccount,
        vaultTokenAccount: vaultTokenAccount,
        mint: usdcMint,
        authority: user.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([user])
      .rpc();

    // Verify user state
    const userState = await program.account.userState.fetch(userStatePDA);
    assert(userState.stakedAmount.eq(amount));
  });

  it("Unstakes tokens", async () => {
    const amount = new anchor.BN(500000); // 0.5 token
    await program.methods
      .unstake(amount)
      .accounts({
        userState: userStatePDA,
        userTokenAccount: userTokenAccount,
        vaultTokenAccount: vaultTokenAccount,
        mint: usdcMint,
        authority: user.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([user])
      .rpc();

    // Verify user state
    const userState = await program.account.userState.fetch(userStatePDA);
    assert(userState.stakedAmount.eq(new anchor.BN(500000))); // Should have 0.5 token left
  });

  it("Settles bill as admin", async () => {
    const amount = new anchor.BN(200000); // 0.2 token
    await program.methods
      .settleBill(amount)
      .accounts({
        userState: userStatePDA,
        vaultTokenAccount: vaultTokenAccount,
        treasuryTokenAccount: treasuryTokenAccount,
        mint: usdcMint,
        admin: adminPDA,
        adminAuthority: admin.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([admin])
      .rpc();

    // Verify user state
    const userState = await program.account.userState.fetch(userStatePDA);
    assert(userState.stakedAmount.eq(new anchor.BN(300000))); // Should have 0.3 token left (0.5 - 0.2)

    // Verify treasury received the funds
    const treasuryBalance = await provider.connection.getTokenAccountBalance(treasuryTokenAccount);
    assert(treasuryBalance.value.amount === "200000");
  });
});
