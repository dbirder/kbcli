#!/usr/local/bin/python3
"""Hermes compatibility: read sync state through the API, never mutate scheduler files."""
import argparse
import json
import urllib.error
import urllib.request
from pathlib import Path


def main(arguments=None, *, token_file=Path('/opt/data/kbcli/agent-token')):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['status', 'health', 'pause', 'resume'])
    args = parser.parse_args(arguments)
    if args.action in {'pause', 'resume'}:
        print(json.dumps({'ok': False, 'error': {'code': 'OPERATOR_ACTION_REQUIRED', 'message': 'Use scripts/kbcli-autosync on the NAS host for pause/resume'}}))
        return 2
    try:
        request = urllib.request.Request('http://kbcli:8765/api/autosync', headers={'Authorization': 'Bearer ' + token_file.read_text().strip()})
        with urllib.request.urlopen(request, timeout=8) as response:
            value = json.load(response)
        if not isinstance(value, dict) or value.get('ok') is not True:
            raise ValueError('Invalid status')
    except (OSError, ValueError, urllib.error.URLError):
        print(json.dumps({'ok': False, 'error': {'code': 'STATUS_UNAVAILABLE', 'message': 'Unable to read sync status; check the kbcli service'}}))
        return 2
    print(json.dumps(value, ensure_ascii=False))
    if args.action == 'health':
        return int(not value.get('worker_alive') or value.get('state') not in {'idle', 'syncing', 'retrying'})
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
