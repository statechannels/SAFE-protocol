import { ethers } from "hardhat";

import { expect, use } from "chai";

describe("Token contract", function () {
  it("Deployment should assign the total supply of tokens to the owner", async () => {
    const l1 = await ethers.getContractFactory("L1Contract");

    const l1Contract = await l1.deploy();
    l1Contract.
  });
});
