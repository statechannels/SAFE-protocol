# Secure Asymmetric Frugal Exchange (SAFE)

# Abstract

In this spec, we introduce the Secure Asymmetric Frugal Exchange (SAFE) protocol for moving assets from one chain or rollup to another. SAFE drastically reduces cost compared to existing solutions while maintaining trustlessness and security. SAFE is particularly cost effective for withdrawing funds from a layer 2 system (such as an optimistic roll-up) to a layer 1 system (such as Ethereum mainnet). We demonstrate transfers with a marginal L1 overhead of under 1500 mainnet Ethereum gas per transfer, based on a preliminary Solidity prototype.

# Overview

SAFE enables users (named Alice in this document) to quickly move tokens on an `ExitChain` to an `EntryChain`, utilizing a liquidity provider (named Bob in this document) who holds liquidity on `EntryChain`. Largest costs savings are where where `ExitChain` transactions are much more expensive than `EntryChain` transactions, minimizing cost with the following design properties:

- Alice only needs to submit a single transaction to `ExitChain`. (In particular, if Alice goes offline at any point during the process, the system can continue smoothly. **_This is important, since Alice is expected to be a regular user and may drop her cell phone in the ocean._**)
- To service a swap for Alice, Bob must submit two `ExitChain` transactions plus one `EntryChain` transactions. However, Bob may service a batch of `n` swaps with this triplet of transactions, amortizing the bulk of the cost across many swaps.

Thus, Alice's swap is serviced with `1 + 2/n` transactions on `ExitChain` and `1/n` transactions on `EntryChain`, where `n` is the number of swaps serviced per batch. (This is slightly inaccurate, since it ignores transactions required by Bob to move liquidity from `ExitChain` back to `EntryChain` and into the holdings contract. Liquidity moves are not required for each batch, so this inaccuracy is likely to be a rounding error.)

_**Note:** The protocol is inspired by optimizing for a specific use case, where `EntryChain` is mainnet Ethereum ("Layer 1", or L1), and `ExitChain` is an optimistic roll-up (ORU) Layer 2, or L2. Users who want to withdraw funds from an ORU L2 must wait an extended period of time before accessing their funds on L1._

1. Alice deposits `x` tokens on `ExitChain`, and is given a ticket `t`, which records that "`x` tokens should be sent to Alice on `EntryChain`", which is initially in the `pending` state.
2. Bob then authorizes `t` by signing a special message `b` containing a batch of tickets, moving it into the `authorized` state.
3. Once it's authorized, Alice _has the ability_ to submit `b` to `EntryChain`, which sends `x` tokens to Alice. (Bob will probably submit `b` for expediency and convenience.) Bob is then forced to wait for a `SafetyWindow` timeout to pass
4. After the `SafetyWindow` timeout passes, Bob can receive Alice's `x` tokens by calling `claimExitChainBatch(b)` on `ExitChain`, which moves `t` into the `claimed` state.

Two things can go majorly wrong:

1. Bob might ghost Alice and never authorize a ticket. If Bob fails to authorize `t` within a certain time window, `AuthorizationWindow`, then Alice can reclaim `x` tokens, moving `t` to the `withdrawn` state.
2. Bob can authorize `t` in a batch `b` on `ExitChain`, but submit a different batch `b'` on `EntryChain`. This is an attributable fault, since Bob promised he would only submit `b`. In this case, Alice can call `proveFraud(b')`, which sends `x` tokens back to Alice on `ExitChain` and moves `t` into the `withdrawn` state.

_**Observation:** SAFE is in fact very similar to a ORU: Alice's desired transaction is recorded in a queue in some smart contract on `Chain2`. Bob triggers a batch of transactions from this queue on `Chain1`. If Bob executes an incorrect batch on `Chain1`, any verifier can prove fraud on `Chain2`, and make users whole. ORUs work similarly to this, with `Chain2` being mainnet Ethereum, Bob being a "sequencer", and `Chain1` being a VM whose state results from applying the queued transactions from some initial state._

# Security Claims

We seek to make safety claims (S1)-(S2) and liveness claims (L1)-(L3) outlined below, based on the following assumptions:

## Assumptions

- Users (Alice) and liquidity providers (Bob) are **_able to_** observe events on `EntryChain` in at most `t_observation_1` time and on `ExitChain` in at most `t_observation_2` time.
- Users (Alice) and liquidity providers (Bob) are **_able to_** submit and get their transaction mined on `EntryChain` in at most `t_submission_1` time and on `ExitChain` in at most `t_submission_2` time.
- Nobody can forge signatures.

## Safety

1. If Alice successfully deposits `x` tokens on `ExitChain`, then Alice can guarantee that
   - either Alice reclaims `x` tokens on `ExitChain`
   - or Alice receives `x` tokens on `EntryChain`
2. If Bob authorizes a ticket with amount `x` on `ExitChain`, then Bob can guarantee that he can receive `x` tokens on `ExitChain`.

## Liveness

**Note:** `t_access_alice`, `t_access_bob` and `t_happy_path` are unspecified, fixed constants.

**Note:** These actually encompass S1-S2.

1. If Alice successfully deposits `x` tokens on `ExitChain`, then Alice can guarantee that `x` tokens are sent to an address provided by Alice, either on `EntryChain` or `ExitChain`, in time at most `t_access_alice`.
2. If Bob has deposited `x` tokens on `EntryChain`, he can guarantee access to a total of `x` tokens across `EntryChain` and `ExitChain` in time at most `t_access_bob`.

   In other words, Bob can recover his liquidity in a fixed amount of time.

3. If Alice and Bob follow the protocol, and Alice successfully registers a ticket, they can guarantee a successful ticket execution in at most `t_happy_path`.

   In particular, Alice and Bob can collaborate to guarantee a successful ticket execution, even if Amy registered a ticket ahead of Alice and then becomes unresponsive.

One area of future research is using our [experience with TLA+](https://blog.statechannels.org/breaking-state-channels/) to formally verify these claims.

# Ticket flow (Happy path)

### 1. Alice locks up funds on `ExitChain` in escrow.

Alice supplies the amount she wishes to swap, as well as some information about `EntryChain` amounts that `ExitChain` can trust _when putting her ticket in the queue._ Essentially, she is asserting "I believe that there are at least `trustedAmount` tokens available on `EntryChain` for tickets with nonce greater than `trustedNonce`." (If Alice submits an unsafe `trustedAmount`, she risks giving some funds to Bob. However, she does not risk another user Amy's funds, since the value she submits does not affect Amy's safety checks.)

A ticket is registered with the next-available nonce, by appending it to the `Tickets` array. Before registering a ticket, the total obligations since `trustedNonce` are tallied in `amountReserved` and deducted from `trustedAmount`. If there are insufficient funds remaining, Alice's ticket is not registered and her deposit is refunded.

```jsx
struct Ticket {
    /// Who will get the funds if executed
    address entryChainRecipient;
    /// The amount of funds to send.
    uint256 value;
    /// The timestamp when the ticket was registered
    uint256 timestamp;
}

// The nonce of the ticket is its index in the array.
Ticket[] public tickets;

struct ExitChainDeposit {
    // the nonce of the most recent "EntryChainAmountAssertion" that Alice trusts
    uint256 trustedNonce;
    // the amount that Alice believes to be available on EntryChain for tickets with
    // nonce *greater than trustedNonce*
    uint256 trustedAmount;
    // the amount Alice wishes to claim on EntryChain
    uint256 depositAmount;
    // Alice's address on EntryChain
    address entryChainRecipient;
}

function depositOnExitChain(ExitChainDeposit calldata deposit) public payable {
    uint256 amountAvailable = deposit.trustedAmount;
    uint256 trustedNonce = deposit.trustedNonce;

    uint256 amountReserved = 0;
    for (uint256 i = trustedNonce; i < tickets.length; i++) {
        amountReserved += tickets[i].value;
    }

    // We don't allow tickets to be registered if there are not enough funds
    // remaining on EntryChain after accounting for already registered tickets.
    require(
        amountAvailable >= amountReserved + deposit.depositAmount,
        "Must have enough funds for ticket"
    );
    require(
        msg.value == deposit.depositAmount,
        "Value sent must match depositAmount"
    );
    Ticket memory ticket = Ticket({
        entryChainRecipient: deposit.entryChainRecipient,
        value: deposit.depositAmount,
        timestamp: block.timestamp
    });

    // ticket's nonce is now its index in `tickets`
    tickets.push(ticket);
}
```

### 2. Bob authorizes withdrawals on `ExitChain`

Bob provides a signature on a batch of tickets.

```jsx
uint256 constant maxAuthDelay;

// Authorized: all tickets in this batch are authorized but not claimed
// Withdrawn: all tickets in this batch are withdrawn (either claimed or refunded)
enum BatchStatus {
    Authorized,
    Withdrawn
}

struct Batch {
    uint256 numTickets;
    uint256 total;
    uint256 authorizedAt;
    BatchStatus status;
}

// `batches` is used to record the fact that tickets with nonce
// between startingNonce and startingNonce + numTickets-1 are
// *authorized, claimed or returned.*
batches = mapping(uint->uint)
// `batches` is used to record the fact that tickets with nonce
// between startingNonce and startingNonce + numTickets-1 are
// *authorized, or withdrawn*.
// Indexed by nonce
mapping(uint256 => Batch) batches;

function authorizeWithdrawal(
    uint256 first,
    uint256 last,
    Signature calldata signature
) public {
    (
        Batch memory batch,
        TicketsWithIndex memory ticketsWithIndex
    ) = createBatch(first, last);
    bytes32 message = keccak256(abi.encode(ticketsWithIndex));
    uint256 earliestTimestamp = tickets[first].timestamp;

    require(nextBatchStart == first, "Batches must be gapless");
    require(
        recoverSigner(message, signature) == lpAddress,
        "Must be signed by liquidity provider"
    );
    uint256 maxAuthTime = earliestTimestamp + maxAuthDelay;
    require(
        block.timestamp <= maxAuthTime,
        "Must be within autorization window"
    );

    batches[first] = batch;
    nextBatchStart = last + 1;
}
```

Suppose Bob authorized one of Alice’s tickets `t` in a batch `b`. When `t` was registered, the `ExitChain` contract made sure that the tickets ahead of Alice would not drain the `EntryChain` contract before paying out `t` in full. Since the `EntryChain` contract’s funds can _only go down_ by submitting a batch `b'` of tickets signed by Bob, when Alice’s ticket gets registered, it’s either the case that:

- The batch `b` is submitted, and Alice receives `t.amount` tokens on `EntryChain`
- Bob signed and submitted a different batch `b' != b`. From `ExitChain`’s point of view, this is an attributable fault, and when given proof of such a fault, tickets are refunded on `ExitChain`.

**_This is the key fact that makes SAFE safe._**

### 3. Anyone calls `claimBatch` on `EntryChain`

```jsx
uint256 nextNonce = 0;
function claimBatch(Ticket[] calldata tickets, Signature calldata signature)
    public
{
    bytes32 message = keccak256(
        abi.encode(TicketsWithIndex(nextNonce, tickets))
    );

    require(
        recoverSigner(message, signature) == lpAddress,
        "Must be signed by liquidity provider"
    );

    for (uint256 i = 0; i < tickets.length; i++) {
        tickets[i].entryChainRecipient.call{
            value: tickets[i].value
        }("");
    }

    nextNonce = nextNonce + tickets.length;
}
```

### 4. Bob claims his funds on `ExitChain`.

We force Bob to wait `SafetyWindow` time before he can claim his `ExitChain` funds. This allows any user to ensure that the correct batch is submitted on `EntryChain`. ⚠️If Bob submits an incorrect batch, users must rescue their funds before the `SafetyWindow` passes.⚠️

```jsx
uint256 constant safetyDelay;

function claimExitChainFunds(uint256 first) public {
    Batch memory batch = batches[first];
    require(
        batch.status == BatchStatus.Authorized,
        "Batch status must be Authorized"
    );
    require(
        block.timestamp > batch.authorizedAt + safetyDelay,
        "safetyDelay must have passed since authorization timestamp"
    );

    batch.status = BatchStatus.Withdrawn;
    batches[first] = batch;
    (bool sent, ) = lpAddress.call{value: batch.total}("");
    require(sent, "Failed to send Ether");
}
```

### 5. Refunding on `ExitChain` after (provable) fraud

When Bob calls `authorizeWithdrawal`, he is enabling anyone to claim a specific batch of tickets on `EntryChain`.

Bob has the unique ability to claim an _arbitrary_ batch of tickets. To do so, he would supply a signature on `batch2` for a different batch of tickets than those he authorized in step 2.

Because `ExitChain` has recorded exactly which batch he claimed he would submit, this is an attributable fault on `ExitChain`! This would let Alice reclaim her escrowed funds. A simple modification of the protocol could penalize Bob for misbehaviour, and compensate Alice for her frustration.

```tsx
function refundOnFraud(
    uint256 honestStartNonce,
    uint256 honestDelta,
    uint256 fraudStartNonce,
    uint256 fraudDelta,
    Ticket[] calldata fraudTickets,
    Signature calldata fraudSignature
) public {
    bytes32 message = keccak256(
        abi.encode(TicketsWithIndex(fraudStartNonce, fraudTickets))
    );
    require(
        honestStartNonce + honestDelta == fraudStartNonce + fraudDelta,
        "Honest and fraud indices must match"
    );
    require(
        recoverSigner(message, fraudSignature) == lpAddress,
        "Must be signed by liquidity provider"
    );

    Ticket memory correctTicket = tickets[honestStartNonce + honestDelta];
    Ticket memory fraudTicket = fraudTickets[fraudDelta];
    require(
        keccak256(abi.encode(correctTicket)) !=
            keccak256(abi.encode(fraudTicket)),
        "Honest and fraud tickets must differ"
    );

    Batch memory honestBatch = batches[honestStartNonce];
    require(
        honestBatch.status == BatchStatus.Authorized,
        "Batch status must be Authorized"
    );

    for (uint256 i = honestStartNonce; i < honestBatch.numTickets; i++) {
        tickets[i].entryChainRecipient.call{
            value: tickets[i].value
        }("");
    }

    batches[honestStartNonce].status = BatchStatus.Withdrawn;
}
```

### 6. Alice reclaims escrow on `ExitChain`

In case Bob fails to perform step (2), we must allow Alice to recover her funds after a timeout.

```tsx
function refund(uint256 index) public {
    require(
        block.timestamp > tickets[index].timestamp + maxAuthDelay,
        "maxAuthDelay must have passed since deposit"
    );

    require(
        nextBatchStart <= index,
        "The nonce must not be a part of a batch"
    );
    (Batch memory batch, ) = createBatch(nextBatchStart, index);
    batches[nextBatchStart] = batch;
    batch.status = BatchStatus.Withdrawn;
    nextBatchStart = index + 1;

    tickets[index].entryChainRecipient.call{
        value: tickets[index].value
    }("");
}
```

# Security analysis

**Claim:** Security properties S1-S2 and L1-L3 hold (found [here](https://www.notion.so/Desired-security-and-usability-properties-a07341b850274837ae48370e3e6b20e8)) with

- `t_access_alice < AuthorizationWindow + t_observation_2 + t_submission_1 + t_observation_1 + t_submission_2`
- `t_access_bob < t_submission_2 + max(2*t_submission_2 + SafetyWWindow, t_submission_1)`
- `t_happy_path < batch_window + t_submission_1`, where `batch_window` is the longest that Bob waits between authorizing batches.

### Proof:

Tickets are grouped into batches. A batch is a set of tickets whose nonce is in some interval `[first, last]`, where indices are inclusive. Batches that are _authorized_ (in step 2) cannot skip tickets.

**(S1 + L3: Alice's funds are safe, happy path is quick)** The following diagram shows how the happy path works, where we are assuming that Bob waits some `batch_window` time before triggering step 2.

Let's say Alice registered a ticket (A1) just before the batch window — let's say it gets included in the batch that Bob authorizes. Two things might happens:

1. Bob _authorizes_ `ticket` in a batch `b` in step 2, before `AuthWindow` passes. This blocks Alice from triggering A6. At this point, the _only batch that can be legally claimed on `EntryChain`_ is `b` itself. Anyone can call `claimBatch(b)`, because Bob signed `b` and submitted it to `ExitChain`, so Alice can trigger [A3] if Bob does not submit [B3] himself.
   1. If Bob does not sign a different batch `b_bad`, then nobody can call `claimBatch` with `b_bad`. Therefore, any transaction calling `claimBatch(b)` will succeed. Alice can submit this transaction, and can therefore receive her funds on `EntryChain`. Bob can receive Alice's `ExitChain` tokens at step 4 (B4).
   2. If Bob signs and submits a different batch `b_bad` in [B3'], then anyone can point out that Bob signed `b_bad` _after committing to only submitting `b`._ This act enables anyone to call `refundOnFraud`. In particular, Alice can trigger step 5, [A5] in the diagram below, which returns `x` tokens to Alice on `ExitChain`.
2. Bob _does not authorize `ticket` in a batch `b` in step 2._

   If Bob does not authorize `ticket`, then after `AuthWindow`, Alice can point out on `ExitChain` that `ticket` has not been authorized, by observing that the latest ticket authorized has nonce less than `ticket.nonce`. (Remember, the `ExitChain` rules dictate that the _next batch authorized_ must start with the next ticket not-yet-authorized. Ie. there are no "gaps" in the set of authorized tickets.)

   In short, the rules say Bob must to authorize tickets within `AuthWindow`, and he failed to do so, `ExitChain` releases the funds to Alice.

The following diagram outlines the happy path. The worst case is if (A1) is submitted at the start of a "batch window". It would take:

- `batch_window` time for Bob to wait for tickets to accumulate.
- `t_submission_1` time for Bob to submit the batch on `EntryChain`. (Note that it's safe for Bob to submit the batch on `EntryChain` in [B3] in parallel with authorizing tickets on `ExitChain` in (B2).)

So, for Alice `t_happy_path < batch_window + t_submission_1`.

![**Happy path** — Bob submits the correct batch on `EntryChain` (B3), but Alice has the option to submit the batch.](img/safe-happy-path.jpg)

**Happy path** — Bob submits the correct batch on `EntryChain` (B3), but Alice has the option to submit the batch.

**(L1: Alice recovers her funds quickly)**

The following diagram shows how long Alice's funds can be locked up:

- Alice submits a deposit in (A1) just before the "batch window" closes.
- Bob doesn't authorize tickets at the end of the batch window, but waits as long as possible to authorize a batch of tickets `b` in (B2) just before Alice can call `reclaimEscrow` in (A6). (Note that (B2) _prevents_ Alice from successfully calling `reclaimEscrow`, since Alice can only reclaim unauthorized tickets.)
- Bob them submits an incorrect batch of tickets `b'` to `EntryChain` in [B3']. This must have happened within `t_observation_2 + t_submission_1` time, because Alice would presumably immediately submit `b` after seeing it posted to `ExitChain`.
  - Note that Alice has detected that Bob is acting funny, because he waited as long as possible to authorize Alice's ticket.
- It would take `t_observation_1` time for Alice to observe [B3'], plus `t_submission_2` time for Alice to call `proveFraud` in (A5).

The total is `t_access_alice = AuthorizationWindow + t_observation_2 + t_submission_1 + t_observation_1 + t_submission_2`.

Note that this proof depends on the following inequality: `SafetyWindow > t_observation_2 + t_submission_1 + t_observation_1 + t_submission_2`. This prevents Bob from submitting an incorrect batch `b'` to `EntryChain` in [B3'], then claiming `ExitChain` funds as though the batch `b` were submitted in [B3'].

![**Bob cheats** by sneaking an incorrect batch in at [B3'], just after the authorization window closes. Alice promptly triggers (A5) well before SafetyWindow passes, guaranteeing that (A5) happens before (B4).](img/safe-sad-path.jpg)

**Bob cheats** by sneaking an incorrect batch in at [B3'], just after the authorization window closes. Alice promptly triggers (A5) well before SafetyWindow passes, guaranteeing that (A5) happens before (B4).

**(S2 + ExitChain: Bob can be made whole quickly)**

Bob can simply register a ticket at any time (`t_submission_2`) for the amount of unspent funds after all previously registered tickets are serviced. (⚠️Let's assume the system allows this functionality⚠️)

Once the ticket is registered, he can authorize a batch including that ticket (`t_submission_2`), wait `SafetyWWindow` time, and call `claimExitChainFunds`, another `t_submission_2` time.

In parallel, he must also claim the batch on `EntryChain`, requiring `t_submission_1` time.

This takes a total of `t_submission_2 + max(2*t_submission_2 + SafetyWindow, t_submission_1)` time.

# Ongoing work: Detailed gas benchmarks with ERC20 support

We are prototyping this spec in this repo: [https://github.com/statechannels/SAFE-protocol/](https://github.com/statechannels/SAFE-protocol/). We would like to calculate in detail how our protocol scales with batching, comparing the cost of this approach to existing solutions.

Since ORU transactions incur an `EntryChain` gas cost, we would like to estimate the total user cost of SAFE by calculating the average amount of calldata required per swap in the `ExitChain` transactions.

# Future work:

### Formal definition/verification of protocol

By formally defining our protocol, we can use formal verification tools to prove our protocol is secure (under some assumptions). Tools like TLA+ can be used to find [security holes that may not be obvious.](https://blog.statechannels.org/breaking-state-channels/)

### Demo of prototype

We would like to showcase the real world applications of this protocol by putting together a basic demo of protocol on a test network.

### Explore staking and incentives

By requiring Bob to stake, we can incentivize others to watch Bob for fraud, penalize Bob for bad behavior, and compensate Alice for opportunity-cost losses and gas expenditures.
