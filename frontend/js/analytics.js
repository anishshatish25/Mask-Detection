/**
 * MASKDETECT - Analytics & Reporting Module
 * Charts, statistics, compliance metrics
 */

// ── STATISTICS CALCULATOR ────────────────────────────────────────────────────
class StatisticsCalculator {
  /**
   * Calculate compliance rate
   */
  static complianceRate(maskCount, totalCount) {
    if (totalCount === 0) return 100;
    return (maskCount / totalCount) * 100;
  }

  /**
   * Calculate violation rate
   */
  static violationRate(noMaskCount, totalCount) {
    if (totalCount === 0) return 0;
    return (noMaskCount / totalCount) * 100;
  }

  /**
   * Calculate trend
   */
  static calculateTrend(current, previous) {
    if (previous === 0) return current > 0 ? 100 : 0;
    return ((current - previous) / previous) * 100;
  }

  /**
   * Group by date
   */
  static groupByDate(records, dateKey = 'timestamp') {
    const grouped = {};
    records.forEach(record => {
      const date = new Date(record[dateKey]).toLocaleDateString();
      if (!grouped[date]) grouped[date] = [];
      grouped[date].push(record);
    });
    return grouped;
  }

  /**
   * Calculate daily stats
   */
  static calculateDailyStats(records) {
    const grouped = this.groupByDate(records);
    return Object.entries(grouped).map(([date, records]) => ({
      date,
      totalFaces: records.reduce((sum, r) => sum + (r.total_faces || 0), 0),
      maskOn: records.reduce((sum, r) => sum + (r.mask_on || 0), 0),
      noMask: records.reduce((sum, r) => sum + (r.no_mask || 0), 0),
      count: records.length,
      avgCompliance: records.reduce((sum, r) => sum + (r.compliance || 0), 0) / records.length
    }));
  }

  /**
   * Get time series data
   */
  static getTimeSeries(records, dateKey = 'timestamp') {
    const grouped = this.groupByDate(records, dateKey);
    return Object.entries(grouped)
      .sort(([dateA], [dateB]) => new Date(dateA) - new Date(dateB))
      .map(([date, items]) => ({
        label: date,
        value: items.reduce((sum, item) => sum + (item.total_faces || 0), 0)
      }));
  }

  /**
   * Calculate percentile
   */
  static percentile(values, p) {
    if (values.length === 0) return 0;
    const sorted = values.sort((a, b) => a - b);
    const index = (p / 100) * sorted.length;
    const lower = Math.floor(index - 1);
    const upper = Math.ceil(index);
    const weight = index % 1;
    if (lower === upper) return sorted[lower];
    return sorted[lower] * (1 - weight) + sorted[upper] * weight;
  }

  /**
   * Calculate moving average
   */
  static movingAverage(values, period = 7) {
    const result = [];
    for (let i = 0; i < values.length; i++) {
      const start = Math.max(0, i - period + 1);
      const slice = values.slice(start, i + 1);
      result.push(slice.reduce((a, b) => a + b, 0) / slice.length);
    }
    return result;
  }
}

// ── CHART RENDERER ────────────────────────────────────────────────────────────
class ChartRenderer {
  /**
   * Create canvas chart element
   */
  static createCanvas(containerId, width = 600, height = 300) {
    const container = DOM.query(`#${containerId}`);
    if (!container) return null;

    const canvas = DOM.create('canvas', {
      width: width.toString(),
      height: height.toString()
    });
    container.appendChild(canvas);
    return canvas.getContext('2d');
  }

  /**
   * Draw bar chart (using Canvas)
   */
  static drawBarChart(ctx, data, options = {}) {
    const {
      width = 600,
      height = 300,
      barColor = 'rgb(59, 130, 246)',
      textColor = 'rgb(31, 41, 55)',
      gridColor = 'rgb(230, 230, 230)'
    } = options;

    ctx.clearRect(0, 0, width, height);

    const padding = 40;
    const chartWidth = width - padding * 2;
    const chartHeight = height - padding * 2;
    const maxValue = Math.max(1, ...data.map(d => d.value));
    const barWidth = chartWidth / data.length * 0.8;
    const barGap = chartWidth / data.length * 0.2;

    // Draw grid
    ctx.strokeStyle = gridColor;
    ctx.lineWidth = 1;
    for (let i = 0; i <= 5; i++) {
      const y = padding + (chartHeight / 5) * i;
      ctx.beginPath();
      ctx.moveTo(padding, y);
      ctx.lineTo(width - padding, y);
      ctx.stroke();
    }

    // Draw bars
    ctx.fillStyle = barColor;
    data.forEach((item, index) => {
      const x = padding + index * (chartWidth / data.length) + barGap / 2;
      const barHeight = (item.value / maxValue) * chartHeight;
      const y = padding + chartHeight - barHeight;

      ctx.fillRect(x, y, barWidth, barHeight);

      // Draw label
      ctx.fillStyle = textColor;
      ctx.font = '12px Arial';
      ctx.textAlign = 'center';
      ctx.fillText(item.label, x + barWidth / 2, height - padding + 20);
    });
  }

  /**
   * Draw line chart (using Canvas)
   */
  static drawLineChart(ctx, data, options = {}) {
    const {
      width = 600,
      height = 300,
      lineColor = 'rgb(59, 130, 246)',
      pointColor = 'rgb(59, 130, 246)',
      textColor = 'rgb(31, 41, 55)',
      gridColor = 'rgb(230, 230, 230)'
    } = options;

    ctx.clearRect(0, 0, width, height);

    const padding = 40;
    const chartWidth = width - padding * 2;
    const chartHeight = height - padding * 2;
    const maxValue = Math.max(1, ...data.map(d => d.value));
    const pointRadius = 3;

    // Draw grid
    ctx.strokeStyle = gridColor;
    ctx.lineWidth = 1;
    for (let i = 0; i <= 5; i++) {
      const y = padding + (chartHeight / 5) * i;
      ctx.beginPath();
      ctx.moveTo(padding, y);
      ctx.lineTo(width - padding, y);
      ctx.stroke();
    }

    // Draw line
    ctx.strokeStyle = lineColor;
    ctx.lineWidth = 2;
    ctx.beginPath();

    data.forEach((item, index) => {
      const x = padding + (index / Math.max(1, data.length - 1)) * chartWidth;
      const y = padding + chartHeight - (item.value / maxValue) * chartHeight;

      if (index === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    });

    ctx.stroke();

    // Draw points
    ctx.fillStyle = pointColor;
    data.forEach((item, index) => {
      const x = padding + (index / Math.max(1, data.length - 1)) * chartWidth;
      const y = padding + chartHeight - (item.value / maxValue) * chartHeight;

      ctx.beginPath();
      ctx.arc(x, y, pointRadius, 0, Math.PI * 2);
      ctx.fill();

      // Draw label
      ctx.fillStyle = textColor;
      ctx.font = '12px Arial';
      ctx.textAlign = 'center';
      ctx.fillText(item.label, x, height - padding + 20);
    });
  }

  /**
   * Draw pie chart (using Canvas)
   */
  static drawPieChart(ctx, data, options = {}) {
    const { width = 300, height = 300, colors = [] } = options;

    ctx.clearRect(0, 0, width, height);

    const centerX = width / 2;
    const centerY = height / 2;
    const radius = Math.min(width, height) / 2 - 20;
    const total = data.reduce((sum, d) => sum + d.value, 0);

    let startAngle = -Math.PI / 2;

    data.forEach((item, index) => {
      const sliceAngle = (item.value / total) * Math.PI * 2;
      const color = colors[index] || `hsl(${(index * 360) / data.length}, 70%, 60%)`;

      // Draw slice
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(centerX, centerY, radius, startAngle, startAngle + sliceAngle);
      ctx.lineTo(centerX, centerY);
      ctx.fill();

      // Draw label
      const labelAngle = startAngle + sliceAngle / 2;
      const labelX = centerX + Math.cos(labelAngle) * (radius * 0.7);
      const labelY = centerY + Math.sin(labelAngle) * (radius * 0.7);

      ctx.fillStyle = 'white';
      ctx.font = 'bold 12px Arial';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`${Math.round((item.value / total) * 100)}%`, labelX, labelY);

      startAngle += sliceAngle;
    });
  }
}

// ── REPORT GENERATOR ──────────────────────────────────────────────────────────
class ReportGenerator {
  /**
   * Generate compliance report
   */
  static generateComplianceReport(records) {
    const totalRecords = records.length;
    const totalFaces = records.reduce((sum, r) => sum + (r.total_faces || 0), 0);
    const maskOn = records.reduce((sum, r) => sum + (r.mask_on || 0), 0);
    const noMask = records.reduce((sum, r) => sum + (r.no_mask || 0), 0);
    const avgCompliance = records.length > 0 ?
      records.reduce((sum, r) => sum + (r.compliance || 0), 0) / records.length : 100;

    const bySource = {};
    records.forEach(r => {
      if (!bySource[r.source]) {
        bySource[r.source] = { count: 0, faces: 0, mask: 0, noMask: 0, compliance: 0 };
      }
      bySource[r.source].count++;
      bySource[r.source].faces += r.total_faces || 0;
      bySource[r.source].mask += r.mask_on || 0;
      bySource[r.source].noMask += r.no_mask || 0;
      bySource[r.source].compliance += r.compliance || 0;
    });

    return {
      generatedAt: new Date().toISOString(),
      totalScans: totalRecords,
      totalFaces,
      maskOnCount: maskOn,
      noMaskCount: noMask,
      complianceRate: StatisticsCalculator.complianceRate(maskOn, totalFaces),
      avgCompliance,
      bySource: Object.entries(bySource).map(([source, stats]) => ({
        source,
        scans: stats.count,
        totalFaces: stats.faces,
        maskOn: stats.mask,
        noMask: stats.noMask,
        avgCompliance: stats.count > 0 ? stats.compliance / stats.count : 100
      }))
    };
  }

  /**
   * Export as JSON
   */
  static exportJSON(data, filename) {
    const json = JSON.stringify(data, null, 2);
    downloadFile(new Blob([json], { type: 'application/json' }), filename);
  }

  /**
   * Export as CSV
   */
  static exportCSV(records, filename) {
    const headers = ['ID', 'Source', 'Timestamp', 'Total Faces', 'Mask On', 'No Mask', 'Compliance %'];
    const rows = records.map(r => [
      r.id,
      r.source,
      r.timestamp,
      r.total_faces,
      r.mask_on,
      r.no_mask,
      r.compliance.toFixed(1)
    ]);

    const csv = [headers, ...rows].map(row =>
      row.map(cell => `"${cell}"`).join(',')
    ).join('\n');

    downloadFile(new Blob([csv], { type: 'text/csv' }), filename);
  }
}

// ── COMPLIANCE SCORER ──────────────────────────────────────────────────────────
class ComplianceScorer {
  /**
   * Calculate compliance score with weighting
   */
  static calculateScore(maskCount, noMaskCount, historicalRate = 100) {
    const total = maskCount + noMaskCount;
    if (total === 0) return 100;

    const currentRate = (maskCount / total) * 100;
    const historicalWeight = 0.2;
    const currentWeight = 0.8;

    const score = (currentRate * currentWeight) + (historicalRate * historicalWeight);
    return Math.min(100, Math.max(0, score));
  }

  /**
   * Get score badge (A-F)
   */
  static getGrade(score) {
    if (score >= 95) return { grade: 'A+', color: 'success' };
    if (score >= 90) return { grade: 'A', color: 'success' };
    if (score >= 85) return { grade: 'B', color: 'success' };
    if (score >= 75) return { grade: 'C', color: 'warning' };
    if (score >= 60) return { grade: 'D', color: 'warning' };
    return { grade: 'F', color: 'danger' };
  }

  /**
   * Get recommendations
   */
  static getRecommendations(score, noMaskCount) {
    const recommendations = [];

    if (score < 80) {
      recommendations.push('Increase monitoring frequency during peak hours');
      recommendations.push('Conduct compliance awareness training');
    }

    if (noMaskCount > 10) {
      recommendations.push('Implement stricter enforcement policies');
      recommendations.push('Review video footage for repeat offenders');
    }

    if (score >= 95) {
      recommendations.push('Current compliance is excellent, maintain monitoring');
    }

    return recommendations;
  }
}

// ── METRIC FORMATTER ──────────────────────────────────────────────────────────
class MetricFormatter {
  /**
   * Format compliance metric
   */
  static formatCompliance(percentage) {
    const rounded = Math.round(percentage);
    return {
      value: rounded,
      percentage: `${rounded}%`,
      status: rounded >= 90 ? 'good' : rounded >= 75 ? 'fair' : 'poor'
    };
  }

  /**
   * Format detection summary
   */
  static formatDetectionSummary(maskCount, noMaskCount) {
    const total = maskCount + noMaskCount;
    return {
      total,
      maskOn: maskCount,
      noMask: noMaskCount,
      maskOnPercent: total > 0 ? ((maskCount / total) * 100).toFixed(1) : 0,
      noMaskPercent: total > 0 ? ((noMaskCount / total) * 100).toFixed(1) : 0,
      summary: `${maskCount} masked, ${noMaskCount} unmasked out of ${total} total`
    };
  }

  /**
   * Format duration
   */
  static formatDuration(ms) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
  }
}

// Export analytics modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    StatisticsCalculator,
    ChartRenderer,
    ReportGenerator,
    ComplianceScorer,
    MetricFormatter
  };
}
