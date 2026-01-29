import socket
import time
import csv
from datetime import datetime

# Optional plotting
try:
    import matplotlib.pyplot as plt
    HAS_PLOT = True
except ImportError:
    HAS_PLOT = False

DOMAINS = ["google.com", "github.com", "example.com"]
BAD_DOMAIN = "nonexistentdomainforschoolproject123.com"

# Timeout to avoid hanging too long on failures
socket.setdefaulttimeout(3)

def measure_dns(domain: str):
    """
    Measures DNS resolution time via OS resolver (socket.getaddrinfo).
    Returns: dict with results.
    """
    start = time.perf_counter()
    try:
        socket.getaddrinfo(domain, None)
        duration_ms = (time.perf_counter() - start) * 1000
        return {
            "domain": domain,
            "success": True,
            "duration_ms": round(duration_ms, 2),
            "error": ""
        }
    except Exception as e:
        duration_ms = (time.perf_counter() - start) * 1000
        return {
            "domain": domain,
            "success": False,
            "duration_ms": round(duration_ms, 2),
            "error": str(e)
        }

def save_csv(results, filename):
    with open(filename, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=["timestamp", "domain", "success", "duration_ms", "error"])
        writer.writeheader()
        for r in results:
            writer.writerow({
                "timestamp": datetime.now().isoformat(timespec="seconds"),
                **r
            })

def plot_results(results, filename="dns_times.png"):
    if not HAS_PLOT:
        print("\n[Plot] matplotlib not installed, skipping plot.")
        print("To install: pip install matplotlib")
        return

    labels = [r["domain"] for r in results]
    times = [r["duration_ms"] for r in results]

    plt.figure(figsize=(9, 4))
    plt.bar(labels, times)
    plt.title("DNS Resolution Time (ms)")
    plt.ylabel("ms")
    plt.xticks(rotation=20, ha="right")
    plt.tight_layout()
    plt.savefig(filename)
    print(f"[Plot] Saved: {filename}")

def main():
    print("\nDNS Impact on Application Behavior (CSV + Plot)\n")

    results = []

    # Normal domains
    for d in DOMAINS:
        r = measure_dns(d)
        results.append(r)
        print(f"{d:35} -> {r['duration_ms']:7} ms | success={r['success']}")

    # Bad domain
    r = measure_dns(BAD_DOMAIN)
    results.append(r)
    print(f"{BAD_DOMAIN:35} -> {r['duration_ms']:7} ms | success={r['success']}")
    if not r["success"]:
        print("Error:", r["error"])

    # Save CSV
    csv_name = "dns_results.csv"
    save_csv(results, csv_name)
    print(f"\n[CSV] Saved: {csv_name}")

    # Plot
    plot_results(results, "dns_times.png")

if __name__ == "__main__":
    main()
