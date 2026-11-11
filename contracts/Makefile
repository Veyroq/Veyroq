# Veyroq Contracts Makefile
-include .env
export

FORGE := /home/binlawal/.foundry/bin/forge
CAST  := /home/binlawal/.foundry/bin/cast

.PHONY: all build test clean test-verbose deploy-testnet deploy-simulate verify-testnet

CONTRACT_ADDRESS ?= 0x56204E81959cE4015507d8d20434d28DBC166fE2

all: build

build:
	$(FORGE) build

test:
	$(FORGE) test

test-verbose:
	$(FORGE) test -vvv

clean:
	$(FORGE) clean

deploy-simulate:
	@echo "Simulating VeyroqRegistry deployment on Arc Testnet..."
	$(FORGE) script script/Deploy.s.sol:DeployVeyroqRegistry --rpc-url arc_testnet -vvv

deploy-testnet:
	@echo "Deploying VeyroqRegistry to Arc Testnet (Chain ID 5042002)..."
	$(FORGE) script script/Deploy.s.sol:DeployVeyroqRegistry --rpc-url arc_testnet --broadcast

verify-testnet:
	@echo "Verifying VeyroqRegistry ($(CONTRACT_ADDRESS)) on Circle Arc Testnet..."
	@echo "  owner():         $$($(CAST) call $(CONTRACT_ADDRESS) 'owner()(address)' --rpc-url arc_testnet)"
	@echo "  treasury():      $$($(CAST) call $(CONTRACT_ADDRESS) 'treasury()(address)' --rpc-url arc_testnet)"
	@echo "  usdcToken():     $$($(CAST) call $(CONTRACT_ADDRESS) 'usdcToken()(address)' --rpc-url arc_testnet)"
	@echo "  protocolFee():   $$($(CAST) call $(CONTRACT_ADDRESS) 'protocolFee()(uint256)' --rpc-url arc_testnet)"
	@echo "  enterpriseFee(): $$($(CAST) call $(CONTRACT_ADDRESS) 'enterpriseFee()(uint256)' --rpc-url arc_testnet)"
	@echo "  partnerFee():    $$($(CAST) call $(CONTRACT_ADDRESS) 'partnerFee()(uint256)' --rpc-url arc_testnet)"
	@node -e 'fetch("https://explorer.testnet.arc.io/api/v2/smart-contracts/$(CONTRACT_ADDRESS)").then(r=>r.json()).then(d=>console.log("  Explorer Status: is_verified=" + d.is_verified + ", name=" + d.name + ", verified_at=" + d.verified_at))'
