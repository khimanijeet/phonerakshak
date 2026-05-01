$baseUrl = "https://phonerakshak-api.onrender.com/api"

Write-Host "Adding mock devices..."
Invoke-RestMethod -Uri "$baseUrl/devices" -Method Post -ContentType "application/json" -Body '{"deviceId":"MOCK_DEV_1","phoneNumber":"+91 9876543210","emergencyNumber":"+91 9999999999","deviceModel":"Samsung S24 Ultra","city":"Mumbai"}'
Invoke-RestMethod -Uri "$baseUrl/devices" -Method Post -ContentType "application/json" -Body '{"deviceId":"MOCK_DEV_2","phoneNumber":"+91 8765432109","emergencyNumber":"+91 8888888888","deviceModel":"OnePlus 12","city":"Delhi"}'
Invoke-RestMethod -Uri "$baseUrl/devices" -Method Post -ContentType "application/json" -Body '{"deviceId":"MOCK_DEV_3","phoneNumber":"+91 7654321098","emergencyNumber":"+91 7777777777","deviceModel":"Google Pixel 8 Pro","city":"Bangalore"}'

Write-Host "Adding mock locations..."
Invoke-RestMethod -Uri "$baseUrl/locations" -Method Post -ContentType "application/json" -Body '{"deviceId":"MOCK_DEV_1","latitude":19.0760,"longitude":72.8777,"accuracy":12.5,"trigger":"manual"}'
Invoke-RestMethod -Uri "$baseUrl/locations" -Method Post -ContentType "application/json" -Body '{"deviceId":"MOCK_DEV_1","latitude":19.0765,"longitude":72.8780,"accuracy":15.0,"trigger":"interval"}'
Invoke-RestMethod -Uri "$baseUrl/locations" -Method Post -ContentType "application/json" -Body '{"deviceId":"MOCK_DEV_2","latitude":28.7041,"longitude":77.1025,"accuracy":20.0,"trigger":"emergency"}'

Write-Host "Adding mock alerts..."
Invoke-RestMethod -Uri "$baseUrl/alerts" -Method Post -ContentType "application/json" -Body '{"deviceId":"MOCK_DEV_1","type":"sim_changed","message":"SIM card changed to +91 9111111111","meta":{"newSim":"+91 9111111111"}}'
Invoke-RestMethod -Uri "$baseUrl/alerts" -Method Post -ContentType "application/json" -Body '{"deviceId":"MOCK_DEV_2","type":"blocked_call","message":"Blocked spam call from +91 8000000000","meta":{"blockedNumber":"+91 8000000000"}}'

Write-Host "Done!"
