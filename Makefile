# Veyroq Root Orchestration Makefile

.PHONY: all build test test-contracts clean serve-landing serve-console serve-docs

all: build

build:
	@echo "==> Building Veyroq smart contracts with Foundry..."
	$(MAKE) -C contracts build

test:
	@echo "==> Running Veyroq Foundry test suite..."
	$(MAKE) -C contracts test

test-verbose:
	@echo "==> Running Veyroq Foundry test suite with traces..."
	$(MAKE) -C contracts test-verbose

clean:
	@echo "==> Cleaning build artifacts..."
	$(MAKE) -C contracts clean

serve-landing:
	@echo "==> Serving Veyroq Landing Page (http://localhost:3000)..."
	python3 -m http.server 3000 --directory landing

serve-console:
	@echo "==> Serving Veyroq Auditor Cockpit (http://localhost:3001)..."
	python3 -m http.server 3001 --directory console

serve-docs:
	@echo "==> Serving Veyroq Protocol Docs (http://localhost:3002)..."
	python3 -m http.server 3002 --directory docs
