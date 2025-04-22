import * as anchor from "@project-serum/anchor";
import { Program } from "@project-serum/anchor";
import { SamachiStaking } from "../target/types/samachi_staking";
import { PublicKey, SystemProgram, SYSVAR_RENT_PUBKEY } from "@solana/web3.js";
import { Token, TOKEN_PROGRAM_ID } from "@solana/spl-token";

describe("samachi-staking", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.SamachiStaking as Program<SamachiStaking>;

  // USDC mint (replace with actual USDC devnet mint)
  const usdcMint = new PublicKey("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"); // USDC devnet

  // Admin keypair
  const admin = anchor.web3.Keypair.generate();

  // User keypair
  const user = anchor.web3.Keypair.generate();

  // PDA seeds
  const [vaultPDA, vaultBump] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), usdcMint.toBuffer()],
    program.programId
  );

  const [userStatePDA, userStateBump] = PublicKey.findProgramAddressSync(
    [Buffer.from("user"), user.publicKey.toBuffer()],
    program.programId
  );

  const [adminPDA, adminBump] = PublicKey.findProgramAddressSync(
    [Buffer.from("admin")],
    program.programId
  );

  // Token accounts
  let userTokenAccount: PublicKey;
  let vaultTokenAccount: PublicKey;
  let treasuryTokenAccount: PublicKey;

  before(async () => {
    // Airdrop SOL to admin and user
    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(admin.publicKey, 1000000000)
    );
    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(user.publicKey, 1000000000)
    );

    // Create token accounts
    userTokenAccount = await Token.createAssociatedTokenAccount(
      provider.connection,
      user,
      usdcMint,
      user.publicKey
    );

    vaultTokenAccount = await Token.createAssociatedTokenAccount(
      provider.connection,
      user, // Using user as payer
      usdcMint,
      vaultPDA,
      true // Allow owner off curve
    );

    treasuryTokenAccount = await Token.createAssociatedTokenAccount(
      provider.connection,
      admin,
      usdcMint,
      admin.publicKey
    );

    // Mint some USDC to user
    // Note: In devnet, you might need to use a faucet or create your own mint
    // This is just a placeholder
    const mintAuthority = user;
    await Token.mintTo(
      provider.connection,
      mintAuthority,
      usdcMint,
      userTokenAccount,
      mintAuthority,
      1000000 // 1 USDC (6 decimals)
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

  it("Stakes USDC", async () => {
    const amount = new anchor.BN(100000); // 0.1 USDC

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

    // Verify stake amount
    const userState = await program.account.userState.fetch(userStatePDA);
    assert.ok(userState.stakedAmount.eq(amount));
  });

  it("Settles bill", async () => {
    const amount = new anchor.BN(50000); // 0.05 USDC

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

    // Verify new stake amount
    const userState = await program.account.userState.fetch(userStatePDA);
    assert.ok(userState.stakedAmount.eq(new anchor.BN(50000))); // 100000 - 50000
  });

  it("Unstakes remaining USDC", async () => {
    const amount = new anchor.BN(50000); // Remaining 0.05 USDC

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

    // Verify final stake amount
    const userState = await program.account.userState.fetch(userStatePDA);
    assert.ok(userState.stakedAmount.eq(new anchor.BN(0)));
  });
});
