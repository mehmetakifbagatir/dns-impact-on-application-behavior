# DNS Impact on Application Behavior

This project analyzes how DNS resolution affects application performance and error behavior.

## Description
The application measures DNS resolution time using Python and the system DNS resolver (`socket.getaddrinfo`).
It compares successful DNS lookups with a failed lookup scenario.

## How to Run
```bash
python dns_impact_csv_plot.py
## Example Output
The project produces:
- Terminal output with DNS resolution times
- A CSV file (`dns_results.csv`) containing measured results
- A graph (`dns_times.png`) visualizing DNS latency differences

## Notes
DNS resolution times may vary between runs due to caching and network conditions.
