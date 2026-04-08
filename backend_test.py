import requests
import sys
import time
import json
from datetime import datetime

class NetworkAnalysisAPITester:
    def __init__(self, base_url="https://port-stress-test.preview.emergentagent.com"):
        self.base_url = base_url
        self.tests_run = 0
        self.tests_passed = 0

    def run_test(self, name, method, endpoint, expected_status, data=None, timeout=10):
        """Run a single API test"""
        url = f"{self.base_url}/api/{endpoint}"
        headers = {'Content-Type': 'application/json'}

        self.tests_run += 1
        print(f"\n🔍 Testing {name}...")
        print(f"   URL: {url}")
        
        try:
            if method == 'GET':
                response = requests.get(url, headers=headers, timeout=timeout)
            elif method == 'POST':
                response = requests.post(url, json=data, headers=headers, timeout=timeout)

            success = response.status_code == expected_status
            if success:
                self.tests_passed += 1
                print(f"✅ Passed - Status: {response.status_code}")
                try:
                    response_data = response.json()
                    if isinstance(response_data, dict) and len(response_data) > 0:
                        print(f"   Response keys: {list(response_data.keys())}")
                except:
                    print(f"   Response length: {len(response.text)} chars")
            else:
                print(f"❌ Failed - Expected {expected_status}, got {response.status_code}")
                print(f"   Response: {response.text[:200]}...")

            return success, response.json() if response.headers.get('content-type', '').startswith('application/json') else response.text

        except Exception as e:
            print(f"❌ Failed - Error: {str(e)}")
            return False, {}

    def test_root_endpoint(self):
        """Test root API endpoint"""
        return self.run_test("Root API", "GET", "", 200)

    def test_status_endpoint(self):
        """Test status endpoint"""
        success, response = self.run_test("Status", "GET", "status", 200)
        if success and isinstance(response, dict):
            required_keys = ['metrics', 'activeConnections', 'connectionHistory', 'portUsage', 'scenarioResults', 'isRunning']
            missing_keys = [key for key in required_keys if key not in response]
            if missing_keys:
                print(f"   ⚠️  Missing keys in status response: {missing_keys}")
            else:
                print(f"   ✅ All required status keys present")
        return success

    def test_start_experiment(self):
        """Test starting experiment"""
        config = {
            "numClients": 5,
            "requestRate": 2,
            "burstMode": False,
            "longLived": True
        }
        success, response = self.run_test("Start Experiment", "POST", "start", 200, config)
        if success:
            time.sleep(2)  # Give time for experiment to start
        return success

    def test_stop_experiment(self):
        """Test stopping experiment"""
        return self.run_test("Stop Experiment", "POST", "stop", 200)

    def test_reset_system(self):
        """Test system reset"""
        return self.run_test("Reset System", "POST", "reset", 200)

    def test_run_scenarios(self):
        """Test running all scenarios"""
        success, response = self.run_test("Run All Scenarios", "POST", "run-scenarios", 200)
        if success:
            print("   ⏳ Scenarios started, this will take time to complete...")
        return success

    def test_analysis_endpoint(self):
        """Test analysis endpoint"""
        success, response = self.run_test("Analysis", "GET", "analysis", 200)
        if success and isinstance(response, dict) and 'analysis' in response:
            print(f"   ✅ Analysis contains {len(response['analysis'])} insights")
        return success

    def test_export_endpoint(self):
        """Test CSV export endpoint"""
        success, response = self.run_test("Export CSV", "GET", "export", 200, timeout=15)
        if success and isinstance(response, str) and response.startswith("Connection ID"):
            line_count = len(response.split('\n'))
            print(f"   ✅ CSV export working, {line_count} lines")
        return success

    def test_tcp_server_connectivity(self):
        """Test if TCP server is accessible (indirect test via status)"""
        print(f"\n🔍 Testing TCP Server Connectivity...")
        try:
            # Start a small experiment to test TCP connectivity
            config = {"numClients": 2, "requestRate": 1, "burstMode": False, "longLived": False}
            start_success, _ = self.run_test("TCP Test Start", "POST", "start", 200, config)
            
            if start_success:
                time.sleep(3)  # Let it run briefly
                
                # Check status to see if connections were made
                status_success, status_data = self.run_test("TCP Test Status", "GET", "status", 200)
                
                if status_success and isinstance(status_data, dict):
                    total_connections = status_data.get('metrics', {}).get('totalConnections', 0)
                    if total_connections > 0:
                        print(f"   ✅ TCP server working - {total_connections} connections made")
                        self.tests_passed += 1
                    else:
                        print(f"   ❌ TCP server may not be working - no connections made")
                
                # Stop the test
                self.run_test("TCP Test Stop", "POST", "stop", 200)
                
            self.tests_run += 1
            return start_success and status_success and total_connections > 0
            
        except Exception as e:
            print(f"❌ TCP connectivity test failed: {str(e)}")
            self.tests_run += 1
            return False

def main():
    print("🚀 Starting Network Analysis System API Tests")
    print("=" * 60)
    
    tester = NetworkAnalysisAPITester()
    
    # Test basic endpoints
    tester.test_root_endpoint()
    tester.test_status_endpoint()
    tester.test_analysis_endpoint()
    
    # Test system control
    tester.test_reset_system()
    time.sleep(1)
    
    # Test experiment control
    tester.test_start_experiment()
    time.sleep(2)
    tester.test_stop_experiment()
    time.sleep(1)
    
    # Test TCP server connectivity
    tester.test_tcp_server_connectivity()
    
    # Test export functionality
    tester.test_export_endpoint()
    
    # Test scenario running (this takes longer)
    print(f"\n⚠️  Note: Scenario testing takes ~40+ seconds to complete")
    run_scenarios = input("Run full scenario test? (y/N): ").lower().startswith('y')
    if run_scenarios:
        tester.test_run_scenarios()
        print("   ⏳ Waiting 45 seconds for scenarios to complete...")
        time.sleep(45)
        
        # Check if scenarios completed
        success, status_data = tester.run_test("Scenario Results Check", "GET", "status", 200)
        if success and isinstance(status_data, dict):
            scenario_results = status_data.get('scenarioResults', [])
            if len(scenario_results) > 0:
                print(f"   ✅ Scenarios completed - {len(scenario_results)} results")
            else:
                print(f"   ⚠️  Scenarios may still be running or failed")
    
    # Print results
    print(f"\n📊 Test Results")
    print("=" * 60)
    print(f"Tests passed: {tester.tests_passed}/{tester.tests_run}")
    success_rate = (tester.tests_passed / tester.tests_run) * 100 if tester.tests_run > 0 else 0
    print(f"Success rate: {success_rate:.1f}%")
    
    if success_rate >= 80:
        print("🎉 Backend API tests mostly successful!")
        return 0
    else:
        print("⚠️  Some backend API tests failed")
        return 1

if __name__ == "__main__":
    sys.exit(main())