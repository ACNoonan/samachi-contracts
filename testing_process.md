**Incremental Testing Plan**

The goal is to start with the absolute minimum deployable contract and gradually re-introduce functionality, testing each step.

**Base State (Commit this):**

- Comment out *all* instruction logic (initialize_user, stake, unstake, settle_bill) within the #[program] block.
- Comment out the corresponding instruction context structs (InitializeUser, Stake, Unstake, SettleBill).
- Keep InitializeVault, VaultAuthority, and UserState structs defined (but UserState won't be used initially). Keep VaultAuthority::SPACE and UserState::SPACE.
- Keep the initialize_vault instruction and its context struct InitializeVault uncommented. This is often a fundamental setup step.
- Keep error enums, constants, declare_id!, and necessary imports.

**Testing Steps:**

**Step 1: Vault Initialization** ✅

- **Code:** Only initialize_vault instruction logic and InitializeVault context are active.
    - **~~Test Goal:** Can the program deploy? Can the vault and its authority PDA be successfully initialized by calling initialize_vault from the frontend (or a test script)?~~

**Step 2: User State Initialization**

- **Code:** Uncomment initialize_user logic and the InitializeUser context struct. Keep UserState struct definition uncommented.
    - **Test Goal:** After initializing the vault (Step 1), can a new user successfully initialize their UserState account by calling initialize_user?

**Step 3: Staking**

- **Code:** Uncomment stake logic and the Stake context struct.
- **Test Goal:** After initializing vault and user state, can a user successfully stake tokens by calling stake? Verify the user_state.staked_amount increases and tokens move to the vault_token_account.

**Step 4: Unstaking**

- **Code:** Uncomment unstake logic and the Unstake context struct.
- **Test Goal:** After staking tokens, can a user successfully unstake them by calling unstake? Verify user_state.staked_amount decreases and tokens move back to the user_token_account. Test edge cases (unstaking more than staked).

**Step 5: Bill Settlement**

- **Code:** Uncomment settle_bill logic and the SettleBill context struct (ensure the admin_state reference remains commented out within SettleBill as it is currently).
- **Test Goal:** After a user has staked tokens, can the designated admin_authority (as a signer) successfully settle a bill by calling settle_bill? Verify the user_state.staked_amount decreases and tokens move to the treasury_token_account. Test edge cases (settling more than staked).

## **Smart Contract Change Process (The Loop)**

Here's the detailed workflow for each incremental step:

**Modify Contract Code:**

- Navigate to the contracts directory:
    
    `cd /Users/adamnoonan/Documents/samachi-contracts`
    
- Edit the smart contract file (usually libs.rs).
    - programs/samachi-contracts/src/lib.rs.
        - Uncomment the specific instruction logic and context struct(s) for the current testing step (e.g., for Step 2, uncomment initialize_user and InitializeUser).

**Build Contract:**

- Compile the contract to ensure it builds correctly and generate the latest IDL and binary.
    
    `anchor build`
    

**Start/Reset Local Validator:**

- Open a **separate terminal window**.
- Navigate to the contracts directory:
    
    `cd /Users/adamnoonan/Documents/samachi-contracts`
    
- Start the local validator, resetting its state each time to ensure a clean environment:
    
    `solana-test-validator --reset`
    
- Keep this terminal running.
    - Note the RPC URL (usually `http://127.0.0.1:8899`) and WebSocket URL (usually `ws://127.0.0.1:8900`).

**Deploy to Local Validator:**

- Open terminal in contracts folder `/Users/adamnoonan/Documents/samachi-contracts`
- Deploy the built program to the running local validator. Anchor should pick up the local cluster from Anchor.toml or default correctly. If unsure, specify localnet.
    
    `anchor deploy --provider.cluster localnet`
    
- **Crucially, note the Program ID** output by this command (e.g., Program Id: <NEW_PROGRAM_ID>). You *might* get the same ID on subsequent deploys to the reset validator if your declare_id! is fixed, but always double-check.

**Update IDL Metadata (If necessary):**

- If the Program ID from anchor deploy *differs* from the one currently in your declare_id! macro and target/idl/samachi_staking.json, update the IDL's metadata:
    
    `anchor idl set <NEW_PROGRAM_ID_FROM_DEPLOY> --filepath /Users/adamnoonan/Documents/samachi-contracts/target/idl/samachi_staking.json --provider.cluster localnet`
    
    - *(Self-correction/Best Practice): Ideally, you should also update the declare_id!("...") in lib.rs to match the deployed ID and rebuild/redeploy. For consistency, updating declare_id! and rebuilding/redeploying is better.*
    - Localnet stage 1: 89yQQn9poeC6Co2s6fpqio7sHH7jx5s9Qgtem4uZqwrN
    
    `anchor idl set 89yQQn9poeC6Co2s6fpqio7sHH7jx5s9Qgtem4uZqwrN --filepath /Users/adamnoonan/Documents/samachi-contracts/target/idl/samachi_staking.json --provider.cluster localnet`
    

**Integrate IDL with Frontend:**

- Copy the potentially updated IDL file to your Next.js app's location:
    
    `cp /Users/adamnoonan/Documents/samachi-contracts/target/idl/samachi_staking.json /Users/adamnoonan/Documents/samachi-app/app/idl/samachi_staking.json`
    
    - *(Assumption: You have a directory lib/idl/ in your Next.js project)*. Adjust the destination path if needed.
- Copy the updated typescript types to your Next.js app’s location:
    
    `cp /Users/adamnoonan/Documents/samachi-contracts/target/types/samachi_staking.ts /Users/adamnoonan/Documents/samachi-app/app/idl/samachi_staking.ts`
    

**Update Frontend Configuration:**

- Navigate to the frontend directory:
    
    `cd /Users/adamnoonan/Documents/samachi-app`
    
- Ensure your frontend code (e.g., in constants file, environment variables, or context provider) is configured to:
    - Use the **correct Program ID**
        - Localnet test 1: 89yQQn9poeC6Co2s6fpqio7sHH7jx5s9Qgtem4uZqwrN
    - Connect to the **local validator's RPC endpoint** (http://127.0.0.1:8899).
    - Load the updated IDL (samachi_staking.json).
    - Notable files to check:
        - **`app/context/SolanaContext.tsx`**
        - **`app/providers.tsx`**
        - **.env.local**
        - **next.config.mjs**

**Test Frontend Integration:**

- Clear cache
    
    `rm -rf node_modules && rm -rf .next && pnpm install`
    
- Start your Next.js development server:
    
    `pnpm dev`
    
- Open your browser and navigate to the parts of your application that interact with the *currently uncommented* contract features.
- Use your browser's developer console to check for runtime errors.
- Perform the actions related to the current step (e.g., click the button that calls initialize_user).
- Verify the expected outcome (e.g., success toast, updated state, console logs from the contract in the solana-test-validator terminal).
1. **(Optional but Recommended) Anchor Tests:**
- Before or alongside frontend testing, run Anchor's integrated tests against the local validator for more direct contract interaction testing:
    
    `cd /Users/adamnoonan/Documents/samachi-contracts`
    
    `anchor test --provider.cluster localnet`
    
- You'll need to update your `tests/samachi-staking.ts` file incrementally as well to test only the active features.
1. **Repeat:**
- If the step was successful, commit your changes (both contract and frontend).
- Go back to Step 1 (Modify Contract Code) for the next incremental feature.
- If you encounter errors, debug them using the validator logs, browser console, and contract logic. You might need to add more msg! logs in your Rust code and rebuild/redeploy. Once fixed, continue the process.

This methodical approach should help you isolate where issues might be occurring in your contract or its integration with the frontend.