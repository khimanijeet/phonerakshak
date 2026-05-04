document.addEventListener('DOMContentLoaded', () => {
  // Chart defaults for dark theme
  Chart.defaults.color = '#94a3b8';
  Chart.defaults.font.family = "'Inter', system-ui, sans-serif";
  Chart.defaults.plugins.tooltip.backgroundColor = 'rgba(15, 21, 43, 0.9)';
  Chart.defaults.plugins.tooltip.titleColor = '#fff';
  Chart.defaults.plugins.tooltip.bodyColor = '#e2e8f0';
  Chart.defaults.plugins.tooltip.borderColor = 'rgba(255,255,255,0.1)';
  Chart.defaults.plugins.tooltip.borderWidth = 1;

  // 1. Security Overview (Line Chart)
  const ctxSecurity = document.getElementById('securityOverviewChart');
  const serverData = window.SERVER_DATA || {};
  const labels = serverData.labels || ['May 3', 'May 4', 'May 5', 'May 6', 'May 7', 'May 8', 'May 9'];
  const threatsData = serverData.threats || [42, 38, 30, 40, 35, 45, 30];
  const blockedData = serverData.blocked || [20, 18, 15, 22, 18, 25, 12];

  if (ctxSecurity) {
    new Chart(ctxSecurity, {
      type: 'line',
      data: {
        labels: labels,
        datasets: [
          {
            label: 'Threats Detected',
            data: threatsData,
            borderColor: '#ef4444',
            backgroundColor: 'rgba(239, 68, 68, 0.1)',
            borderWidth: 2,
            tension: 0.4,
            pointBackgroundColor: '#ef4444',
            pointBorderColor: '#0b1020',
            pointBorderWidth: 2,
            pointRadius: 4,
          },
          {
            label: 'Blocked Attempts',
            data: blockedData,
            borderColor: '#8b5cf6',
            backgroundColor: 'rgba(139, 92, 246, 0.1)',
            borderWidth: 2,
            tension: 0.4,
            pointBackgroundColor: '#8b5cf6',
            pointBorderColor: '#0b1020',
            pointBorderWidth: 2,
            pointRadius: 4,
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false }
        },
        scales: {
          x: {
            grid: { display: false, drawBorder: false }
          },
          y: {
            grid: { color: 'rgba(255, 255, 255, 0.05)', drawBorder: false },
            min: 0,
            max: 60,
            ticks: { stepSize: 20 }
          }
        }
      }
    });
  }

  // 2. Top Attack Types (Doughnut Chart)
  const ctxAttackTypes = document.getElementById('topAttackTypesChart');
  const at = serverData.attackTypes || { bruteForce: 65, failedLogins: 20, ddos: 10, apiSpam: 5 };
  
  if (ctxAttackTypes) {
    new Chart(ctxAttackTypes, {
      type: 'doughnut',
      data: {
        labels: ['Brute Force', 'Failed Logins', 'DDoS Attacks', 'API Spam'],
        datasets: [{
          data: [at.bruteForce, at.failedLogins, at.ddos, at.apiSpam],
          backgroundColor: ['#ef4444', '#8b5cf6', '#3b82f6', '#f59e0b'],
          borderWidth: 0,
          hoverOffset: 4
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '75%',
        plugins: {
          legend: { display: false }
        }
      }
    });
  }

  // 3. Device Status (Doughnut Chart)
  const ctxDeviceStatus = document.getElementById('deviceStatusChart');
  if (ctxDeviceStatus) {
    const dsOnline = parseInt(ctxDeviceStatus.getAttribute('data-online')) || 869;
    const dsOffline = parseInt(ctxDeviceStatus.getAttribute('data-offline')) || 198;
    
    new Chart(ctxDeviceStatus, {
      type: 'doughnut',
      data: {
        labels: ['Online', 'Offline', 'Inactive'],
        datasets: [{
          data: [dsOnline, dsOffline, 0],
          backgroundColor: ['#22c55e', '#ef4444', '#64748b'],
          borderWidth: 0
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '80%',
        plugins: { legend: { display: false }, tooltip: { enabled: false } }
      }
    });
  }

  // 4. Subscription Status (Doughnut Chart)
  const ctxSubscriptionStatus = document.getElementById('subscriptionStatusChart');
  if (ctxSubscriptionStatus) {
    const sActive = parseInt(ctxSubscriptionStatus.getAttribute('data-active')) || 1048;
    const sExpired = parseInt(ctxSubscriptionStatus.getAttribute('data-expired')) || 150;
    const sPending = parseInt(ctxSubscriptionStatus.getAttribute('data-pending')) || 50;

    new Chart(ctxSubscriptionStatus, {
      type: 'doughnut',
      data: {
        labels: ['Active', 'Expired', 'Pending'],
        datasets: [{
          data: [sActive, sExpired, sPending],
          backgroundColor: ['#22c55e', '#ef4444', '#f59e0b'],
          borderWidth: 0
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '80%',
        plugins: { legend: { display: false }, tooltip: { enabled: false } }
      }
    });
  }
});
