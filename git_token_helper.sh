#!/bin/bash
# Git credential helper: returns the GitHub PAT stored in .deploy_token
# Invoked by git as: credential.helper=!/abs/path/git_token_helper.sh
if [ "$1" = "get" ]; then
  DIR="$(cd "$(dirname "$0")" && pwd)"
  TOKEN="$(cat "$DIR/.deploy_token" 2>/dev/null)"
  if [ -n "$TOKEN" ]; then
    # For a GitHub classic PAT over HTTPS, use the token both as username and password.
    echo "username=$TOKEN"
    echo "password=$TOKEN"
  fi
fi
# silently accept store/erase
exit 0
