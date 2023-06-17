#!/bin/bash

SCRIPT_DIR=$( cd -- "$( dirname -- "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )

while [[ $# -gt 0 ]]; do
  case $1 in
    -c|--check|--check-only)
      CHECK_ONLY="$1"
      shift
      ;;
    *)
      echo "Unsupported flag set"
      exit 1
      ;;
  esac
done

if [ -z ${CHECK_ONLY+x} ];
then
    npm run lint-fix
    "${SCRIPT_DIR}"/../../.github/scripts/python_lint.sh
else
    npm run lint-check
    "${SCRIPT_DIR}"/../../.github/scripts/python_lint.sh --check
fi
