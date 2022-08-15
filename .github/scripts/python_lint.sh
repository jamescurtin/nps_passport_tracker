#! /usr/bin/env bash
set -euo pipefail

CHECK_ONLY=''


usage() {
  cat << EOF >&2
Usage: $0 [OPTIONS]
Options:
-c, --check    Check for required changes and fail if they exist
-h, --help     Show this message and exit
EOF
}

process_args() {
    while test $# -gt 0
    do
      case "$1" in
          --check | -c) CHECK_ONLY='--check'
              ;;
          -h) usage;
              exit 0
              ;;
          --help) usage;
              exit 0
              ;;
          *) usage;
              exit 1;
              ;;
      esac
      shift
  done
}

process_args "$@"

echo "Running isort..."
eval "isort ${CHECK_ONLY} ."

echo "Running black..."
eval "black ${CHECK_ONLY} ."

echo "Running flake8..."
flake8 .

echo "Running mypy..."
mypy .github/scripts
