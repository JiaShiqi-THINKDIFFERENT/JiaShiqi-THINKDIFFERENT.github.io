/**
 * 评分总览表（三好 /three-good/ 与 四维度 /four-dim/ 共用）
 * ------------------------------------------------------------------
 * 挂载点：<div class="score-table" data-src="/three-good/data/index.json"
 *                 data-base="/three-good/"></div>
 *
 * 表格结构：股票名（代码，点击进入报告）｜申万一级行业｜近五次综合评分｜结论
 * 只展示最新 5 篇，其余进入「历史归档」折叠区（后台留存，仍可点击进入）。
 *
 * 分数涨跌遵循 A 股习惯：上升=红，下降=绿。
 */

(function () {
  var RECENT_N = 5;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function fmt(v) {
    return typeof v === 'number' && isFinite(v) ? v.toFixed(1) : '—';
  }

  function shortDate(d) {
    return /^\d{4}-\d{2}-\d{2}/.test(d || '') ? d.slice(5) : (d || '—');
  }

  /** 迷你走势：返回 SVG 字符串；升红降绿 */
  function spark(vals) {
    var pts = vals.filter(function (v) { return typeof v === 'number' && isFinite(v); });
    if (pts.length < 2) return '';
    var w = 96, h = 22, pad = 3;
    var min = Math.min.apply(null, pts), max = Math.max.apply(null, pts);
    if (max - min < 1e-6) { max = min + 1; }
    var step = pts.length > 1 ? (w - pad * 2) / (pts.length - 1) : 0;
    var xy = pts.map(function (v, i) {
      return [pad + i * step, h - pad - (v - min) / (max - min) * (h - pad * 2)];
    });
    var line = xy.map(function (p) { return p[0].toFixed(1) + ',' + p[1].toFixed(1); }).join(' ');
    var up = pts[pts.length - 1] >= pts[0];
    var color = up ? '#c62828' : '#1e8e3e';
    var area = 'M' + xy[0][0].toFixed(1) + ',' + (h - pad) + ' L' + line.split(' ').join(' L') +
      ' L' + xy[xy.length - 1][0].toFixed(1) + ',' + (h - pad) + ' Z';
    return '<svg class="st-spark" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '" aria-hidden="true">' +
      '<path d="' + area + '" fill="' + color + '" opacity="0.10"/>' +
      '<polyline points="' + line + '" fill="none" stroke="' + color + '" stroke-width="1.6" ' +
      'stroke-linejoin="round" stroke-linecap="round"/></svg>';
  }

  /** 近 N 期评分序列：固定 N 格，不足的空着（最新一期永远在最右） */
  function seriesCell(series, n) {
    var s = (series || []).slice(-n);
    if (!s.length) return '<span class="st-empty">—</span>';
    var vals = s.map(function (x) { return x.total; });
    var html = '<div class="st-series">';
    for (var k = 0; k < n - s.length; k++) {
      html += '<span class="st-val st-void" title="暂无该期报告">—</span>';
    }
    s.forEach(function (x, i) {
      var prev = i > 0 ? s[i - 1].total : null;
      var cls = '', arrow = '';
      if (typeof prev === 'number' && typeof x.total === 'number' && Math.abs(x.total - prev) > 0.05) {
        var up = x.total > prev;
        cls = up ? ' st-up' : ' st-down';
        arrow = '<i class="st-arrow' + (up ? ' st-up' : ' st-down') + '">' + (up ? '▲' : '▼') + '</i>';
      }
      var isLast = i === s.length - 1;
      html += '<span class="st-val' + (isLast ? ' st-now' : '') + cls + '" title="' +
        esc(x.date) + '　' + fmt(x.total) + '　' + esc(x.verdict) + '">' +
        fmt(x.total) + arrow + '</span>';
    });
    html += '</div>';
    var sp = spark(vals);
    if (sp) html += '<div class="st-spark-wrap">' + sp + '</div>';
    return html;
  }

  function verdictCell(r) {
    var v = r.latest.verdict || '—';
    var cls = 'v-none';
    if (v.indexOf('强烈推荐') >= 0 || v.indexOf('推荐') >= 0) cls = 'v-good';
    else if (v.indexOf('可关注') >= 0) cls = 'v-hold';
    else if (v.indexOf('观望') >= 0) cls = 'v-watch';
    else if (v.indexOf('不推荐') >= 0 || v.indexOf('远离') >= 0) cls = 'v-bad';
    return '<span class="st-verdict ' + cls + '">' + esc((r.latest.icon || '') + ' ' + v) + '</span>';
  }

  function tableHtml(rows, base, n) {
    var html = '<div class="st-scroll"><table class="st-table"><thead><tr>' +
      '<th class="st-th-name">股票（代码）</th>' +
      '<th>申万一级行业</th>' +
      '<th>近五次综合评分</th>' +
      '<th>结论</th>' +
      '</tr></thead><tbody>';
    rows.forEach(function (r) {
      html += '<tr>' +
        '<td class="st-name"><a href="' + base + r.slug + '/">' + esc(r.name) +
        ' <span class="st-code">(' + esc(r.symbol) + ')</span></a></td>' +
        '<td><span class="st-ind">' + esc(r.industry) + '</span></td>' +
        '<td>' + seriesCell(r.series, n) + '</td>' +
        '<td>' + verdictCell(r) + '</td>' +
        '</tr>';
    });
    html += '</tbody></table></div>';
    return html;
  }

  function mount(el) {
    var src = el.getAttribute('data-src');
    var base = el.getAttribute('data-base') || '/';
    var mode = el.getAttribute('data-mode') || 'index';
    var slug = el.getAttribute('data-slug') || '';

    fetch(src, { cache: 'no-store' })
      .then(function (res) { return res.ok ? res.json() : Promise.reject(new Error(res.status)); })
      .then(function (data) {
        var rows = (data.rows || []).slice();

        // 报告页「往期评分」模式：只取该个股
        if (mode === 'history') {
          rows = rows.filter(function (r) { return r.slug === slug; });
          if (!rows.length) return;
          var h = rows[0].history || [];
          if (h.length < 2) return;
          var hh = '<h2>往期评分（归档）</h2><div class="st-scroll"><table class="st-table">' +
            '<thead><tr><th>日期</th><th>综合分</th><th>结论</th></tr></thead><tbody>';
          h.forEach(function (x) {
            hh += '<tr><td>' + esc(x.date) + '</td><td><strong>' + fmt(x.total) + '</strong></td>' +
              '<td>' + esc(x.verdict) + '</td></tr>';
          });
          hh += '</tbody></table></div>';
          el.innerHTML = hh;
          return;
        }

        if (!rows.length) return;

        // 主表：每只股票一行，按最新一期综合分降序
        rows.sort(function (a, b) {
          return (b.latest.total || 0) - (a.latest.total || 0);
        });
        var updated = data.updated || data.built || '';

        var html = '<div class="st-block">' +
          '<div class="st-head"><h2>评分总览（' + rows.length + ' 只）</h2>' +
          '<span class="st-updated">更新于 ' + esc(String(updated).slice(0, 10)) + '</span></div>' +
          tableHtml(rows, base, RECENT_N) + '</div>';

        // 后台归档：每只股票第 6 篇及更早的往期报告（超出「近五次」的部分）
        var arch = [];
        rows.forEach(function (r) {
          (r.history || []).slice(RECENT_N).forEach(function (x) {
            arch.push({ slug: r.slug, name: r.name, symbol: r.symbol,
                        date: x.date, total: x.total, verdict: x.verdict });
          });
        });
        arch.sort(function (a, b) {
          return a.date < b.date ? 1 : (a.date > b.date ? -1 : (b.total || 0) - (a.total || 0));
        });

        html += '<details class="st-archive"><summary>历史归档 · 第 6 篇及更早的往期报告（' +
          arch.length + ' 条）</summary>';
        if (arch.length) {
          html += '<div class="st-scroll"><table class="st-table"><thead><tr>' +
            '<th>报告日期</th><th>股票（代码）</th><th>综合分</th><th>结论</th>' +
            '</tr></thead><tbody>';
          arch.forEach(function (x) {
            html += '<tr><td>' + esc(x.date) + '</td>' +
              '<td class="st-name"><a href="' + base + x.slug + '/">' + esc(x.name) +
              ' <span class="st-code">(' + esc(x.symbol) + ')</span></a></td>' +
              '<td><strong>' + fmt(x.total) + '</strong></td>' +
              '<td>' + esc(x.verdict) + '</td></tr>';
          });
          html += '</tbody></table></div>';
        } else {
          html += '<p class="st-note">暂无：每只股票目前都只有 5 篇以内的报告，' +
            '随着每周更新，超出近五次的往期记录会自动归档到这里。</p>';
        }
        html += '</details>';

        html += '<p class="st-note">点击股票名进入完整评分报告；「近五次综合评分」为该股最近 5 篇报告，' +
          '按旧 → 新排列、不足 5 篇的留空，▲ 红为环比上升、▼ 绿为环比下降。</p>';
        el.innerHTML = html;
      })
      .catch(function () {
        el.innerHTML = '<p class="st-note">评分数据加载失败，请稍后刷新。</p>';
      });
  }

  var nodes = document.querySelectorAll('.score-table');
  for (var i = 0; i < nodes.length; i++) mount(nodes[i]);
})();
