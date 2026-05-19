# Calibration Schema

Calibration files live under `.github/agent-state/calibration/`.

Each JSON file may contain:

```json
{
  "version": 1,
  "phase": "F2",
  "items": [
    {
      "id": "example",
      "expected": "approve",
      "actual": "approve",
      "notes": "optional"
    }
  ]
}
```

`scripts/compute-calibration.ps1` reads these files and reports agreement.
