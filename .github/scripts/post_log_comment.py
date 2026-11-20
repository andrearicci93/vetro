#!/usr/bin/env python3
"""Only this step receives the issue-write token; it does not download reports."""
import argparse
import json
from pathlib import Path
from parse_log import issue_matches, post_comment, MARKER

parser = argparse.ArgumentParser()
parser.add_argument('--event', type=Path, required=True)
parser.add_argument('--comment', type=Path, required=True)
args = parser.parse_args()
issue = json.loads(args.event.read_text(encoding='utf-8')).get('issue')
if issue_matches(issue):
    body = args.comment.read_text(encoding='utf-8')
    if not body.startswith(MARKER) or len(body) > 15000:
        raise ValueError('Invalid generated comment')
    post_comment(issue, body)
    print('Diagnostic comment posted or updated')
