//! Sendam: real-world intents for Nigerian bills.
//!
//! Someone abroad locks USDC in a request ("₦20,000 of electricity to this meter").
//! A local agent claims the request, pays the bill from their own naira, and a
//! verifier confirms the payment with the bill provider. The contract then pays the
//! agent. A request nobody fulfils is refunded to the sender after it expires.
//!
//! Money only ever moves to two places: the agent named in a confirmed claim, or
//! the sender who funded the request.

use near_contract_standards::fungible_token::receiver::FungibleTokenReceiver;
use near_sdk::json_types::U128;
use near_sdk::store::IterableMap;
use near_sdk::{
    env, ext_contract, near, require, AccountId, BorshStorageKey, Gas, NearToken, PanicOnDefault,
    Promise, PromiseError, PromiseOrValue,
};

/// How long a request may stay open, in minutes.
pub const MIN_EXPIRY_MINUTES: u64 = 10;
pub const MAX_EXPIRY_MINUTES: u64 = 7 * 24 * 60;
/// Smallest and largest bill, in naira (whole naira).
pub const MIN_NAIRA: u64 = 500;
pub const MAX_NAIRA: u64 = 500_000;
/// Default time an agent holds a claim before others may take the request.
pub const DEFAULT_CLAIM_MINUTES: u64 = 30;

const GAS_FT_TRANSFER: Gas = Gas::from_tgas(10);
const GAS_CALLBACK: Gas = Gas::from_tgas(10);
const ONE_YOCTO: NearToken = NearToken::from_yoctonear(1);
const MINUTE_MS: u64 = 60_000;

#[ext_contract(ext_ft)]
pub trait FungibleToken {
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>);
}

#[derive(BorshStorageKey)]
#[near]
enum StorageKey {
    Requests,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
#[serde(tag = "state", rename_all = "snake_case")]
pub enum Status {
    Open,
    Claimed { agent: AccountId, until_ms: u64 },
    Fulfilled { agent: AccountId, reference: String, at_ms: u64 },
    Refunded { at_ms: u64 },
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Request {
    pub id: u64,
    pub sender: AccountId,
    /// USDC locked for the agent, in the token's smallest unit.
    pub amount: U128,
    /// The bill to pay, in whole naira.
    pub naira: u64,
    /// Bill provider, for example "ibadan-electric".
    pub provider: String,
    /// Prepaid meter number.
    pub meter: String,
    pub created_ms: u64,
    pub expires_ms: u64,
    /// sha256 (hex) of a secret held by the recipient. The recipient proves the secret
    /// to collect the electricity token; the token itself never goes on chain.
    pub secret_hash: String,
    pub status: Status,
}

/// What the sender puts in the `msg` of `ft_transfer_call`.
#[near(serializers = [json])]
pub struct CreateMsg {
    pub naira: u64,
    pub provider: String,
    pub meter: String,
    pub expires_in_minutes: u64,
    pub secret_hash: String,
}

#[near(serializers = [json])]
pub struct Config {
    pub owner: AccountId,
    pub usdc: AccountId,
    pub verifier: AccountId,
    pub claim_minutes: u64,
    pub next_id: u64,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Sendam {
    owner: AccountId,
    usdc: AccountId,
    verifier: AccountId,
    claim_ms: u64,
    next_id: u64,
    requests: IterableMap<u64, Request>,
}

fn event(kind: &str, data: String) {
    env::log_str(&format!(
        "EVENT_JSON:{{\"standard\":\"sendam\",\"version\":\"1.0.0\",\"event\":\"{kind}\",\"data\":[{data}]}}"
    ));
}

fn is_hex64(s: &str) -> bool {
    s.len() == 64 && s.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

fn valid_provider(p: &str) -> bool {
    p.len() <= 32
        && p.ends_with("-electric")
        && p.len() > "-electric".len()
        && p.bytes().all(|b| b.is_ascii_lowercase() || b == b'-')
}

fn valid_meter(m: &str) -> bool {
    (6..=20).contains(&m.len()) && m.bytes().all(|b| b.is_ascii_digit())
}

#[near]
impl Sendam {
    #[init]
    pub fn new(owner: AccountId, usdc: AccountId, verifier: AccountId, claim_minutes: Option<u64>) -> Self {
        let claim_minutes = claim_minutes.unwrap_or(DEFAULT_CLAIM_MINUTES);
        require!((5..=24 * 60).contains(&claim_minutes), "claim_minutes must be between 5 and 1440");
        Self {
            owner,
            usdc,
            verifier,
            claim_ms: claim_minutes * MINUTE_MS,
            next_id: 1,
            requests: IterableMap::new(StorageKey::Requests),
        }
    }

    // ---- Agents ---------------------------------------------------------------

    /// An agent takes a request, so nobody else pays the same bill.
    pub fn claim(&mut self, id: u64) -> Request {
        let agent = env::predecessor_account_id();
        let now = env::block_timestamp_ms();
        let mut req = self.get_or_panic(id);
        require!(req.sender != agent, "A sender cannot fulfil their own request");
        require!(now < req.expires_ms, "This request has expired");
        match &req.status {
            Status::Open => {}
            Status::Claimed { until_ms, .. } if *until_ms <= now => {}
            Status::Claimed { .. } => env::panic_str("Another agent is working on this request"),
            _ => env::panic_str("This request is closed"),
        }
        req.status = Status::Claimed { agent: agent.clone(), until_ms: now + self.claim_ms };
        self.requests.insert(id, req.clone());
        event("claim", format!("{{\"id\":{id},\"agent\":\"{agent}\"}}"));
        req
    }

    /// An agent gives a request back before paying it.
    pub fn release(&mut self, id: u64) {
        let caller = env::predecessor_account_id();
        let mut req = self.get_or_panic(id);
        match &req.status {
            Status::Claimed { agent, .. } if *agent == caller => {}
            _ => env::panic_str("You do not hold this request"),
        }
        req.status = Status::Open;
        self.requests.insert(id, req);
        event("release", format!("{{\"id\":{id},\"agent\":\"{caller}\"}}"));
    }

    // ---- Verifier -------------------------------------------------------------

    /// The verifier has checked with the bill provider that `agent` paid this bill.
    /// The USDC goes to the agent.
    pub fn confirm(&mut self, id: u64, agent: AccountId, reference: String) -> Promise {
        require!(env::predecessor_account_id() == self.verifier, "Only the verifier can confirm");
        require!(!reference.is_empty() && reference.len() <= 64, "reference must be 1 to 64 characters");
        let mut req = self.get_or_panic(id);
        match &req.status {
            // A lapsed claim still counts: the agent may have paid in good faith, and
            // nobody else has taken the request since.
            Status::Claimed { agent: holder, .. } if *holder == agent => {}
            _ => env::panic_str("This request is not claimed by that agent"),
        }
        let previous = req.status.clone();
        req.status = Status::Fulfilled { agent: agent.clone(), reference: reference.clone(), at_ms: env::block_timestamp_ms() };
        self.requests.insert(id, req.clone());
        event("fulfil", format!("{{\"id\":{id},\"agent\":\"{agent}\",\"reference\":\"{reference}\"}}"));
        self.pay(agent, req.amount, id, previous)
    }

    // ---- Senders --------------------------------------------------------------

    /// Returns the USDC to the sender. The sender may cancel an open request at any
    /// time; anyone may refund a request that has expired without being fulfilled.
    pub fn refund(&mut self, id: u64) -> Promise {
        let caller = env::predecessor_account_id();
        let now = env::block_timestamp_ms();
        let mut req = self.get_or_panic(id);
        let claim_active = matches!(&req.status, Status::Claimed { until_ms, .. } if *until_ms > now);
        match &req.status {
            Status::Open | Status::Claimed { .. } => {}
            _ => env::panic_str("This request is closed"),
        }
        require!(!claim_active, "An agent is working on this request; try again after their claim lapses");
        require!(caller == req.sender || now >= req.expires_ms, "Only the sender can cancel before the request expires");
        let previous = req.status.clone();
        req.status = Status::Refunded { at_ms: now };
        self.requests.insert(id, req.clone());
        event("refund", format!("{{\"id\":{id},\"sender\":\"{}\"}}", req.sender));
        self.pay(req.sender, req.amount, id, previous)
    }

    // ---- Payouts --------------------------------------------------------------

    fn pay(&self, to: AccountId, amount: U128, id: u64, previous: Status) -> Promise {
        ext_ft::ext(self.usdc.clone())
            .with_attached_deposit(ONE_YOCTO)
            .with_static_gas(GAS_FT_TRANSFER)
            .ft_transfer(to, amount, Some(format!("sendam request {id}")))
            .then(Self::ext(env::current_account_id()).with_static_gas(GAS_CALLBACK).on_payout(id, previous))
    }

    /// If the transfer failed (for example the receiver is not registered with the
    /// token), the request goes back to how it was, so the money is never stranded.
    #[private]
    pub fn on_payout(&mut self, id: u64, previous: Status, #[callback_result] result: Result<(), PromiseError>) -> bool {
        if result.is_ok() {
            return true;
        }
        if let Some(req) = self.requests.get_mut(&id) {
            req.status = previous;
        }
        event("payout_failed", format!("{{\"id\":{id}}}"));
        false
    }

    // ---- Owner ----------------------------------------------------------------

    pub fn set_verifier(&mut self, verifier: AccountId) {
        require!(env::predecessor_account_id() == self.owner, "Only the owner can change the verifier");
        self.verifier = verifier;
    }

    // ---- Views ----------------------------------------------------------------

    pub fn get_config(&self) -> Config {
        Config {
            owner: self.owner.clone(),
            usdc: self.usdc.clone(),
            verifier: self.verifier.clone(),
            claim_minutes: self.claim_ms / MINUTE_MS,
            next_id: self.next_id,
        }
    }

    pub fn get_request(&self, id: u64) -> Option<Request> {
        self.requests.get(&id).cloned()
    }

    /// Newest first. `before` is an id to page backwards from.
    pub fn list_requests(&self, before: Option<u64>, limit: Option<u32>) -> Vec<Request> {
        let limit = limit.unwrap_or(20).min(100) as usize;
        let start = before.unwrap_or(self.next_id).min(self.next_id);
        (1..start).rev().filter_map(|id| self.requests.get(&id).cloned()).take(limit).collect()
    }

    /// Requests an agent could take right now: open, or with a lapsed claim, and not expired.
    pub fn list_open(&self, limit: Option<u32>) -> Vec<Request> {
        let now = env::block_timestamp_ms();
        let limit = limit.unwrap_or(50).min(100) as usize;
        (1..self.next_id)
            .rev()
            .filter_map(|id| self.requests.get(&id))
            .filter(|r| r.expires_ms > now)
            .filter(|r| match &r.status {
                Status::Open => true,
                Status::Claimed { until_ms, .. } => *until_ms <= now,
                _ => false,
            })
            .take(limit)
            .cloned()
            .collect()
    }

    pub fn list_by_account(&self, account: AccountId, limit: Option<u32>) -> Vec<Request> {
        let limit = limit.unwrap_or(50).min(100) as usize;
        (1..self.next_id)
            .rev()
            .filter_map(|id| self.requests.get(&id))
            .filter(|r| {
                r.sender == account
                    || matches!(&r.status, Status::Claimed { agent, .. } | Status::Fulfilled { agent, .. } if *agent == account)
            })
            .take(limit)
            .cloned()
            .collect()
    }

    fn get_or_panic(&self, id: u64) -> Request {
        self.requests.get(&id).cloned().unwrap_or_else(|| env::panic_str("No request with that id"))
    }
}

#[near]
impl FungibleTokenReceiver for Sendam {
    /// Creates a request from USDC sent with `ft_transfer_call`.
    fn ft_on_transfer(&mut self, sender_id: AccountId, amount: U128, msg: String) -> PromiseOrValue<U128> {
        require!(env::predecessor_account_id() == self.usdc, "Only the configured USDC token is accepted");
        let m: CreateMsg = near_sdk::serde_json::from_str(&msg).unwrap_or_else(|_| env::panic_str("msg is not a valid request"));
        require!(amount.0 > 0, "amount must be more than zero");
        require!((MIN_NAIRA..=MAX_NAIRA).contains(&m.naira), "naira must be between 500 and 500,000");
        require!(valid_provider(&m.provider), "provider must look like ibadan-electric");
        require!(valid_meter(&m.meter), "meter must be 6 to 20 digits");
        require!(
            (MIN_EXPIRY_MINUTES..=MAX_EXPIRY_MINUTES).contains(&m.expires_in_minutes),
            "expires_in_minutes must be between 10 and 10080"
        );
        require!(is_hex64(&m.secret_hash), "secret_hash must be 64 lowercase hex characters");

        let id = self.next_id;
        self.next_id += 1;
        let now = env::block_timestamp_ms();
        let req = Request {
            id,
            sender: sender_id.clone(),
            amount,
            naira: m.naira,
            provider: m.provider,
            meter: m.meter,
            created_ms: now,
            expires_ms: now + m.expires_in_minutes * MINUTE_MS,
            secret_hash: m.secret_hash,
            status: Status::Open,
        };
        self.requests.insert(id, req);
        event("create", format!("{{\"id\":{id},\"sender\":\"{sender_id}\",\"amount\":\"{}\"}}", amount.0));
        // Keep all of it.
        PromiseOrValue::Value(U128(0))
    }
}

#[cfg(test)]
mod tests;
