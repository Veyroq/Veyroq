#!/bin/sh
mkdir -p .git/hooks
cat << 'EOF' > .git/hooks/pre-commit
#!/bin/sh
echo "🔍 Running pre-commit test suite with 60% coverage threshold..."
npm run test:coverage
STATUS=$?
if [ $STATUS -ne 0 ]; then
  echo "❌ Git commit rejected: Tests failed or code coverage dropped below 60% threshold."
  exit 1
fi
echo "✔ All tests passed and 60% coverage threshold satisfied. Committing..."
exit 0
EOF
chmod +x .git/hooks/pre-commit
echo "✔ Pre-commit hook installed in .git/hooks/pre-commit"
