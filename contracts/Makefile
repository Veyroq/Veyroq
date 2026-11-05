# Veyroq Contracts Makefile
FORGE := /home/binlawal/.foundry/bin/forge
CAST  := /home/binlawal/.foundry/bin/cast

.PHONY: all build test clean test-verbose deploy-testnet

all: build

build:
	$(FORGE) build

test:
	$(FORGE) test

test-verbose:
	$(FORGE) test -vvv

clean:
	$(FORGE) clean

deploy-testnet:
	@echo "Deploying VeyroqRegistry to Arc Testnet (Chain ID 5042002)..."
	$(FORGE) script script/Deploy.s.sol:Deploy --rpc-url arc_testnet --broadcast
