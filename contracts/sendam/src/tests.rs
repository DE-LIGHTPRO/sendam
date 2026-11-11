use super::*;
use near_sdk::test_utils::{get_created_receipts, get_logs, VMContextBuilder};
use near_sdk::{testing_env, PromiseResult, RuntimeFeesConfig};

const MIN: u64 = 60_000;
const T0: u64 = 1_794_000_000_000; // a fixed start time, in ms

fn acc(s: &str) -> AccountId {
    s.parse().unwrap()
}
fn owner() -> AccountId {
    acc("owner.testnet")
}
fn usdc() -> AccountId {
    acc("usdc.testnet")
}
fn verifier() -> AccountId {
    acc("verifier.testnet")
}
fn sender() -> AccountId {
    acc("ada.testnet")
}
fn agent() -> AccountId {
    acc("tunde.testnet")
}
fn agent2() -> AccountId {
    acc("bisi.testnet")
}

/// Sets the caller and the clock (in ms) for the next call.
fn call(caller: &AccountId, at_ms: u64) {
    let ctx = VMContextBuilder::new()
        .current_account_id(acc("sendam.testnet"))
        .predecessor_account_id(caller.clone())
        .block_timestamp(at_ms * 1_000_000)
        .build();
    testing_env!(ctx);
}

/// Simulates the result of the token transfer a callback is waiting on.
fn callback_with(result: PromiseResult) {
    let ctx = VMContextBuilder::new()
        .current_account_id(acc("sendam.testnet"))
        .predecessor_account_id(acc("sendam.testnet"))
        .block_timestamp(T0 * 1_000_000)
        .build();
    testing_env!(ctx, near_sdk::test_vm_config(), RuntimeFeesConfig::test(), Default::default(), vec![result]);
}

fn hash() -> String {
    "a".repeat(64)
}

fn msg(naira: u64, meter: &str, minutes: u64) -> String {
    format!(
        "{{\"naira\":{naira},\"provider\":\"ibadan-electric\",\"meter\":\"{meter}\",\"expires_in_minutes\":{minutes},\"secret_hash\":\"{}\"}}",
        hash()
    )
}

fn contract() -> Sendam {
    call(&owner(), T0);
    Sendam::new(owner(), usdc(), verifier(), None)
}

/// A contract with one open request (id 1): ₦20,000, 12.5 USDC, expires after 60 minutes.
fn with_request() -> Sendam {
    let mut c = contract();
    call(&usdc(), T0);
    let kept = c.ft_on_transfer(sender(), U128(12_500_000), msg(20_000, "1111111111111", 60));
    assert!(matches!(kept, PromiseOrValue::Value(U128(0))));
    c
}

fn transfers() -> Vec<(String, String)> {
    // (receiver of the receipt, method called) for every outgoing call.
    get_created_receipts()
        .iter()
        .flat_map(|r| {
            r.actions.iter().filter_map(move |a| match a {
                near_sdk::mock::MockAction::FunctionCallWeight { method_name, .. } => {
                    Some((r.receiver_id.to_string(), String::from_utf8(method_name.clone()).unwrap()))
                }
                _ => None,
            })
        })
        .collect()
}

#[test]
fn creating_a_request_records_everything_and_logs_an_event() {
    let c = with_request();
    let r = c.get_request(1).unwrap();
    assert_eq!(r.sender, sender());
    assert_eq!(r.amount, U128(12_500_000));
    assert_eq!(r.naira, 20_000);
    assert_eq!(r.meter, "1111111111111");
    assert_eq!(r.expires_ms, T0 + 60 * MIN);
    assert_eq!(r.status, Status::Open);
    assert_eq!(c.get_config().next_id, 2);
    assert!(get_logs()[0].starts_with("EVENT_JSON:{\"standard\":\"sendam\""));
    assert!(get_logs()[0].contains("\"event\":\"create\""));
}

#[test]
#[should_panic(expected = "Only the configured USDC token is accepted")]
fn other_tokens_are_refused() {
    let mut c = contract();
    call(&acc("fake-usdc.testnet"), T0);
    let _ = c.ft_on_transfer(sender(), U128(1), msg(20_000, "1111111111111", 60));
}

#[test]
fn bad_requests_are_refused() {
    let cases = [
        ("not json", "msg is not a valid request"),
        (&msg(100, "1111111111111", 60), "naira must be between"),
        (&msg(600_000, "1111111111111", 60), "naira must be between"),
        (&msg(20_000, "12AB34", 60), "meter must be 6 to 20 digits"),
        (&msg(20_000, "123", 60), "meter must be 6 to 20 digits"),
        (&msg(20_000, "1111111111111", 5), "expires_in_minutes must be between"),
        (&msg(20_000, "1111111111111", 20_000), "expires_in_minutes must be between"),
        (&msg(20_000, "1111111111111", 60).replace(&hash(), "xyz"), "secret_hash must be"),
        (&msg(20_000, "1111111111111", 60).replace("ibadan-electric", "MTN"), "provider must look like"),
    ];
    for (m, expected) in cases {
        let m = m.to_string();
        let err = std::panic::catch_unwind(move || {
            let mut c = contract();
            call(&usdc(), T0);
            let _ = c.ft_on_transfer(sender(), U128(1_000_000), m);
        })
        .expect_err("should have been refused");
        let text = err.downcast_ref::<String>().cloned().unwrap_or_default();
        assert!(text.contains(expected), "expected {expected:?}, got {text:?}");
    }
}

#[test]
fn an_agent_claims_a_request_and_others_must_wait() {
    let mut c = with_request();
    call(&agent(), T0 + MIN);
    let r = c.claim(1);
    assert_eq!(r.status, Status::Claimed { agent: agent(), until_ms: T0 + MIN + 30 * MIN });
    assert!(c.list_open(None).is_empty(), "a claimed request is not open");

    call(&agent2(), T0 + 10 * MIN);
    let err = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        c.claim(1);
    }));
    assert!(err.is_err(), "a second agent cannot take a live claim");
}

#[test]
fn a_lapsed_claim_can_be_taken_by_another_agent() {
    let mut c = with_request();
    call(&agent(), T0);
    c.claim(1);
    call(&agent2(), T0 + 31 * MIN);
    assert_eq!(c.list_open(None).len(), 1, "the lapsed claim shows as open again");
    let r = c.claim(1);
    assert!(matches!(r.status, Status::Claimed { agent, .. } if agent == agent2()));
}

#[test]
#[should_panic(expected = "A sender cannot fulfil their own request")]
fn senders_cannot_claim_their_own_request() {
    let mut c = with_request();
    call(&sender(), T0);
    c.claim(1);
}

#[test]
#[should_panic(expected = "This request has expired")]
fn expired_requests_cannot_be_claimed() {
    let mut c = with_request();
    call(&agent(), T0 + 61 * MIN);
    c.claim(1);
}

#[test]
fn an_agent_can_release_a_claim() {
    let mut c = with_request();
    call(&agent(), T0);
    c.claim(1);
    c.release(1);
    assert_eq!(c.get_request(1).unwrap().status, Status::Open);
}

#[test]
#[should_panic(expected = "You do not hold this request")]
fn only_the_holder_can_release() {
    let mut c = with_request();
    call(&agent(), T0);
    c.claim(1);
    call(&agent2(), T0);
    c.release(1);
}

#[test]
fn the_verifier_confirms_and_the_agent_is_paid() {
    let mut c = with_request();
    call(&agent(), T0);
    c.claim(1);
    call(&verifier(), T0 + 2 * MIN);
    let _ = c.confirm(1, agent(), "17941234567890".into());
    let r = c.get_request(1).unwrap();
    assert_eq!(r.status, Status::Fulfilled { agent: agent(), reference: "17941234567890".into(), at_ms: T0 + 2 * MIN });
    let calls = transfers();
    assert!(calls.contains(&("usdc.testnet".into(), "ft_transfer".into())), "{calls:?}");
    assert!(calls.contains(&("sendam.testnet".into(), "on_payout".into())), "{calls:?}");
}

#[test]
fn a_lapsed_claim_can_still_be_confirmed_for_the_agent_who_paid() {
    let mut c = with_request();
    call(&agent(), T0);
    c.claim(1);
    call(&verifier(), T0 + 45 * MIN);
    let _ = c.confirm(1, agent(), "ref".into());
    assert!(matches!(c.get_request(1).unwrap().status, Status::Fulfilled { .. }));
}

#[test]
#[should_panic(expected = "Only the verifier can confirm")]
fn only_the_verifier_can_confirm() {
    let mut c = with_request();
    call(&agent(), T0);
    c.claim(1);
    let _ = c.confirm(1, agent(), "ref".into());
}

#[test]
#[should_panic(expected = "This request is not claimed by that agent")]
fn confirming_the_wrong_agent_is_refused() {
    let mut c = with_request();
    call(&agent(), T0);
    c.claim(1);
    call(&verifier(), T0);
    let _ = c.confirm(1, agent2(), "ref".into());
}

#[test]
#[should_panic(expected = "This request is not claimed by that agent")]
fn a_request_cannot_be_paid_twice() {
    let mut c = with_request();
    call(&agent(), T0);
    c.claim(1);
    call(&verifier(), T0);
    let _ = c.confirm(1, agent(), "ref".into());
    let _ = c.confirm(1, agent(), "ref".into());
}

#[test]
fn a_failed_payout_puts_the_request_back_so_it_can_be_retried() {
    let mut c = with_request();
    call(&agent(), T0);
    c.claim(1);
    call(&verifier(), T0);
    let _ = c.confirm(1, agent(), "ref".into());
    let claimed = Status::Claimed { agent: agent(), until_ms: T0 + 30 * MIN };
    callback_with(PromiseResult::Failed);
    assert!(!c.on_payout(1, claimed.clone(), Err(PromiseError::Failed)));
    assert_eq!(c.get_request(1).unwrap().status, claimed);
    // and a successful payout leaves it fulfilled
    call(&verifier(), T0);
    let _ = c.confirm(1, agent(), "ref".into());
    callback_with(PromiseResult::Successful(vec![]));
    assert!(c.on_payout(1, claimed, Ok(())));
    assert!(matches!(c.get_request(1).unwrap().status, Status::Fulfilled { .. }));
}

#[test]
fn the_sender_can_cancel_an_open_request() {
    let mut c = with_request();
    call(&sender(), T0 + MIN);
    let _ = c.refund(1);
    assert_eq!(c.get_request(1).unwrap().status, Status::Refunded { at_ms: T0 + MIN });
    assert!(transfers().contains(&("usdc.testnet".into(), "ft_transfer".into())));
}

#[test]
#[should_panic(expected = "Only the sender can cancel before the request expires")]
fn strangers_cannot_refund_before_expiry() {
    let mut c = with_request();
    call(&agent(), T0);
    let _ = c.refund(1);
}

#[test]
fn anyone_can_refund_after_expiry_and_the_money_goes_to_the_sender() {
    let mut c = with_request();
    call(&agent2(), T0 + 61 * MIN);
    let _ = c.refund(1);
    assert!(matches!(c.get_request(1).unwrap().status, Status::Refunded { .. }));
}

#[test]
#[should_panic(expected = "An agent is working on this request")]
fn a_request_cannot_be_refunded_while_an_agent_is_paying_it() {
    let mut c = with_request();
    call(&agent(), T0);
    c.claim(1);
    call(&sender(), T0 + 5 * MIN);
    let _ = c.refund(1);
}

#[test]
fn after_a_claim_lapses_the_sender_can_cancel() {
    let mut c = with_request();
    call(&agent(), T0);
    c.claim(1);
    call(&sender(), T0 + 31 * MIN);
    let _ = c.refund(1);
    assert!(matches!(c.get_request(1).unwrap().status, Status::Refunded { .. }));
}

#[test]
#[should_panic(expected = "This request is closed")]
fn a_fulfilled_request_cannot_be_refunded() {
    let mut c = with_request();
    call(&agent(), T0);
    c.claim(1);
    call(&verifier(), T0);
    let _ = c.confirm(1, agent(), "ref".into());
    call(&sender(), T0 + 90 * MIN);
    let _ = c.refund(1);
}

#[test]
fn listings_filter_and_page() {
    let mut c = contract();
    for i in 0..5u64 {
        call(&usdc(), T0 + i);
        let _ = c.ft_on_transfer(if i % 2 == 0 { sender() } else { agent2() }, U128(1_000_000), msg(1_000 + i, "1234567890", 60));
    }
    call(&agent(), T0 + 10);
    c.claim(2);
    assert_eq!(c.list_requests(None, Some(2)).iter().map(|r| r.id).collect::<Vec<_>>(), vec![5, 4]);
    assert_eq!(c.list_requests(Some(4), Some(2)).iter().map(|r| r.id).collect::<Vec<_>>(), vec![3, 2]);
    assert_eq!(c.list_open(None).iter().map(|r| r.id).collect::<Vec<_>>(), vec![5, 4, 3, 1]);
    assert_eq!(c.list_by_account(sender(), None).iter().map(|r| r.id).collect::<Vec<_>>(), vec![5, 3, 1]);
    assert_eq!(c.list_by_account(agent(), None).iter().map(|r| r.id).collect::<Vec<_>>(), vec![2]);
}

#[test]
fn only_the_owner_can_change_the_verifier() {
    let mut c = contract();
    call(&owner(), T0);
    c.set_verifier(acc("new-verifier.testnet"));
    assert_eq!(c.get_config().verifier, acc("new-verifier.testnet"));
    call(&agent(), T0);
    assert!(std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| c.set_verifier(agent()))).is_err());
}
