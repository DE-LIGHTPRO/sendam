//! Test USDC for the Sendam demo on NEAR testnet. Anyone can call `faucet` to get
//! 100 test USDC. It has no value and must never be deployed as real money.

use near_contract_standards::fungible_token::core::FungibleTokenCore;
use near_contract_standards::fungible_token::metadata::{FungibleTokenMetadata, FungibleTokenMetadataProvider, FT_METADATA_SPEC};
use near_contract_standards::fungible_token::resolver::FungibleTokenResolver;
use near_contract_standards::fungible_token::FungibleToken;
use near_contract_standards::storage_management::{StorageBalance, StorageBalanceBounds, StorageManagement};
use near_sdk::json_types::U128;
use near_sdk::{env, near, require, AccountId, NearToken, PanicOnDefault, PromiseOrValue};

/// 100 USDC, with 6 decimals.
pub const FAUCET_AMOUNT: u128 = 100_000_000;
/// Nobody may hold more than this from the faucet, so the test token stays small.
pub const FAUCET_CAP: u128 = 10_000_000_000;

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct MockUsdc {
    token: FungibleToken,
}

#[near]
impl MockUsdc {
    #[init]
    pub fn new() -> Self {
        Self { token: FungibleToken::new(b"t".to_vec()) }
    }

    /// Gives the caller 100 test USDC, registering them first if needed.
    /// Registration is paid from this contract's own balance, as it is test money.
    pub fn faucet(&mut self) -> U128 {
        let account = env::predecessor_account_id();
        if !self.token.accounts.contains_key(&account) {
            self.token.internal_register_account(&account);
        }
        let balance = self.token.internal_unwrap_balance_of(&account);
        require!(balance + FAUCET_AMOUNT <= FAUCET_CAP, "You already have plenty of test USDC");
        self.token.internal_deposit(&account, FAUCET_AMOUNT);
        near_contract_standards::fungible_token::events::FtMint {
            owner_id: &account,
            amount: U128(FAUCET_AMOUNT),
            memo: Some("faucet"),
        }
        .emit();
        U128(balance + FAUCET_AMOUNT)
    }

    /// Registers an account (for example the Sendam contract) without a storage deposit.
    pub fn register(&mut self, account_id: AccountId) {
        if !self.token.accounts.contains_key(&account_id) {
            self.token.internal_register_account(&account_id);
        }
    }
}

#[near]
impl FungibleTokenCore for MockUsdc {
    #[payable]
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>) {
        self.token.ft_transfer(receiver_id, amount, memo)
    }

    #[payable]
    fn ft_transfer_call(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>, msg: String) -> PromiseOrValue<U128> {
        self.token.ft_transfer_call(receiver_id, amount, memo, msg)
    }

    fn ft_total_supply(&self) -> U128 {
        self.token.ft_total_supply()
    }

    fn ft_balance_of(&self, account_id: AccountId) -> U128 {
        self.token.ft_balance_of(account_id)
    }
}

#[near]
impl FungibleTokenResolver for MockUsdc {
    #[private]
    fn ft_resolve_transfer(&mut self, sender_id: AccountId, receiver_id: AccountId, amount: U128) -> U128 {
        let (used, _burned) = self.token.internal_ft_resolve_transfer(&sender_id, receiver_id, amount);
        used.into()
    }
}

#[near]
impl StorageManagement for MockUsdc {
    #[payable]
    fn storage_deposit(&mut self, account_id: Option<AccountId>, registration_only: Option<bool>) -> StorageBalance {
        self.token.storage_deposit(account_id, registration_only)
    }

    #[payable]
    fn storage_withdraw(&mut self, amount: Option<NearToken>) -> StorageBalance {
        self.token.storage_withdraw(amount)
    }

    #[payable]
    fn storage_unregister(&mut self, force: Option<bool>) -> bool {
        self.token.internal_storage_unregister(force).is_some()
    }

    fn storage_balance_bounds(&self) -> StorageBalanceBounds {
        self.token.storage_balance_bounds()
    }

    fn storage_balance_of(&self, account_id: AccountId) -> Option<StorageBalance> {
        self.token.storage_balance_of(account_id)
    }
}

#[near]
impl FungibleTokenMetadataProvider for MockUsdc {
    fn ft_metadata(&self) -> FungibleTokenMetadata {
        FungibleTokenMetadata {
            spec: FT_METADATA_SPEC.to_string(),
            name: "Test USDC (Sendam demo)".to_string(),
            symbol: "USDC".to_string(),
            icon: None,
            reference: None,
            reference_hash: None,
            decimals: 6,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::VMContextBuilder;
    use near_sdk::testing_env;

    fn as_caller(who: &str) {
        testing_env!(VMContextBuilder::new().predecessor_account_id(who.parse().unwrap()).build());
    }

    #[test]
    fn the_faucet_registers_and_tops_up_until_the_cap() {
        as_caller("ada.testnet");
        let mut t = MockUsdc::new();
        assert_eq!(t.faucet(), U128(FAUCET_AMOUNT));
        assert_eq!(t.faucet(), U128(2 * FAUCET_AMOUNT));
        assert_eq!(t.ft_balance_of("ada.testnet".parse().unwrap()), U128(2 * FAUCET_AMOUNT));
        assert_eq!(t.ft_metadata().decimals, 6);
        for _ in 2..(FAUCET_CAP / FAUCET_AMOUNT) {
            t.faucet();
        }
        assert!(std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| t.faucet())).is_err());
    }

    #[test]
    fn register_is_idempotent() {
        as_caller("owner.testnet");
        let mut t = MockUsdc::new();
        t.register("sendam.testnet".parse().unwrap());
        t.register("sendam.testnet".parse().unwrap());
        assert_eq!(t.ft_balance_of("sendam.testnet".parse().unwrap()), U128(0));
    }
}
