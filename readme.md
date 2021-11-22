# Stingy Asymmetric Fast Exit protocol (SAFE)

This is a prototype of the SAFE protocol. The protocol allows for secure, trustless fund transfers between chains. The protocol is particularly cost efficient when the gas fees for one chain are meaningfully different (cheaper or more expensive) than another chain. For example, SAFE is useful for transferring tokens from an optimistic rollup to Ethereum mainnet without waiting for the rollup finalization delay.

The protocol is described in detail in the [SAFE paper](https://www.notion.so/statechannels/SAFE-Protocol-cf0b29e8656d4c3e8edfe8329b2fa67e).

## Commands
- `yarn` to install dependencies.
- `yarn test` to run tests.