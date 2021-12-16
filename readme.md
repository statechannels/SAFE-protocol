# Stingy Asymmetric Fast Exit protocol (SAFE)

This is a prototype of the SAFE protocol. The protocol allows for secure, trustless fund transfers between chains. The protocol is particularly cost efficient when the gas fees for one chain are meaningfully different (cheaper or more expensive) than another chain. For example, SAFE is useful for transferring tokens from an optimistic rollup to Ethereum mainnet without waiting for the rollup finalization delay.

The protocol is described in detail in the [SAFE paper](https://www.notion.so/statechannels/SAFE-Protocol-cf0b29e8656d4c3e8edfe8329b2fa67e).

# Getting started
This project uses yarn version 3. You can install yarn version 3 by following [these instructions](https://yarnpkg.com/getting-started/install) from the parent folder of this repository. :warning:This will cause all child folders of the parent directory to use yarn version 3.:warning:

## Commands
- `yarn` to install dependencies.
- `yarn test` to run tests.