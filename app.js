const { createApp } = Vue;
const SERVICE_ITEMS = new Set(['доставка', 'упаковка']);
const MONTH_NAMES = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

createApp({
  data() {
    return {
      rows: [], sourceFile: '', catalog: new Map(), imagePaths: [], selectedCategory: 'all', itemMetric: 'quantity', loading: true, error: '',
      tooltip: { visible: false, x: 0, y: 0, item: {} },
    };
  },
  computed: {
    deliveredRows() { return this.rows.filter((r) => String(r['Статус'] || '').trim().toLowerCase() === 'доставлен'); },
    productRows() { return this.deliveredRows.filter((r) => !SERVICE_ITEMS.has(String(r['Название позиции'] || '').trim().toLowerCase())); },
    filteredProductRows() { return this.selectedCategory === 'all' ? this.productRows : this.productRows.filter((r) => r['Категория'] === this.selectedCategory); },
    filteredRows() { return this.selectedCategory === 'all' ? this.deliveredRows : this.filteredProductRows; },
    categories() { return [...new Set(this.productRows.map((r) => r['Категория']).filter(Boolean))].sort(d3.ascending); },
    uniqueOrders() { return new Set(this.filteredRows.map((r) => r['Номер заказа'])).size; },
    uniqueProducts() { return new Set(this.filteredProductRows.map((r) => r['Название позиции'])).size; },
    totalAmount() { return d3.sum(this.filteredRows, (r) => Number(r['Сумма']) || 0); },
    totalQuantity() { return d3.sum(this.filteredProductRows, (r) => Number(r['Количество товаров']) || 0); },
    averageDiscount() { return d3.mean(this.filteredRows, (r) => Number(r['Скидка']) || 0) || 0; },
    monthlyMetrics() {
      const groups = d3.group(this.filteredRows, (r) => this.monthKey(r['Дата заказа']));
      const all = [...groups].sort(([a], [b]) => d3.ascending(a, b)).map(([key, rows]) => ({
        key, label: this.monthLabel(key), orders: new Set(rows.map((r) => r['Номер заказа'])).size,
        spend: d3.sum(rows, (r) => Number(r['Сумма']) || 0), discount: d3.mean(rows, (r) => Number(r['Скидка']) || 0) || 0,
      }));
      return all.slice(-24);
    },
    currentMetrics() { return this.monthlyMetrics[this.monthlyMetrics.length - 1] || { orders: 0, spend: 0, discount: 0, label: 'нет данных' }; },
    currentMonthLabel() { return this.currentMetrics.label || 'текущий месяц'; },
    periodLabel() { return this.monthlyMetrics.length ? `${this.monthlyMetrics[0].label} — ${this.monthlyMetrics[this.monthlyMetrics.length - 1].label}` : 'нет данных'; },
    productSummary() {
      return [...d3.group(this.filteredProductRows, (r) => r['Название позиции'] || 'Без названия')].map(([name, rows]) => {
        const monthly = [...d3.group(rows, (r) => this.monthKey(r['Дата заказа']))].sort(([a], [b]) => d3.ascending(a, b)).slice(-24).map(([key, monthRows]) => ({ key, label: this.monthLabel(key), price: d3.sum(monthRows, (r) => Number(r['Сумма']) || 0) / Math.max(1, d3.sum(monthRows, (r) => Number(r['Количество товаров']) || 0)) }));
        const quantity = d3.sum(rows, (r) => Number(r['Количество товаров']) || 0);
        const spend = d3.sum(rows, (r) => Number(r['Сумма']) || 0);
        const avgPrice = spend / Math.max(1, quantity);
        const first = monthly[0]?.price || avgPrice; const last = monthly[monthly.length - 1]?.price || avgPrice;
        const fallbackImage = this.imagePaths.length ? this.imagePaths[this.imageHash(name) % this.imagePaths.length] : '';
        return { name, category: rows[0]['Категория'] || 'Без категории', quantity, spend, avgPrice, priceChange: last - first, monthly, image: this.catalog.get(name) || fallbackImage };
      });
    },
    topByQuantity() { return [...this.productSummary].sort((a, b) => d3.descending(a.quantity, b.quantity)).slice(0, 8); },
    topBySpend() { return [...this.productSummary].sort((a, b) => d3.descending(a.spend, b.spend)).slice(0, 8); },
    maxQuantity() { return d3.max(this.topByQuantity, (x) => x.quantity) || 1; },
    maxSpend() { return d3.max(this.topBySpend, (x) => x.spend) || 1; },
    categorySummary() {
      const groups = d3.group(this.productRows, (r) => r['Категория'] || 'Без категории');
      const total = d3.sum(this.productRows, (r) => Number(r['Сумма']) || 0) || 1;
      return [...groups].map(([name, rows]) => {
        const products = d3.rollups(rows, (items) => d3.sum(items, (r) => Number(r['Количество товаров']) || 0), (r) => r['Название позиции']);
        return { name, quantity: d3.sum(rows, (r) => Number(r['Количество товаров']) || 0), spend: d3.sum(rows, (r) => Number(r['Сумма']) || 0), share: d3.sum(rows, (r) => Number(r['Сумма']) || 0) / total * 100, topProduct: products.sort((a, b) => d3.descending(a[1], b[1]))[0]?.[0] || '—' };
      }).sort((a, b) => d3.descending(a.spend, b.spend));
    },
  },
  methods: {
    formatInteger(v) { return d3.format(',.0f')(Number(v) || 0).replaceAll(',', ' '); },
    formatCurrency(v) { return `${d3.format(',.2f')(Number(v) || 0).replaceAll(',', ' ')} ₽`; },
    signedCurrency(v) { const n = Number(v) || 0; return `${n >= 0 ? '+' : ''}${this.formatCurrency(n)}`; },
    monthKey(v) { const d = new Date(v); return Number.isNaN(d.getTime()) ? 'unknown' : d3.timeFormat('%Y-%m')(d); },
    monthLabel(key) { if (key === 'unknown') return '—'; const [year, month] = key.split('-'); return `${MONTH_NAMES[Number(month) - 1]} ${year}`; },
    imageHash(value) { let hash = 0; for (let i = 0; i < value.length; i++) hash = ((hash << 5) - hash + value.charCodeAt(i)) | 0; return Math.abs(hash); },
    parseCatalog(text) { const map = new Map(); text.replace(/^\uFEFF/, '').split(/\r?\n/).filter(Boolean).slice(1).forEach((line) => { const [code, name, category, file] = line.split(';'); if (code && name && file) map.set(name.trim(), `products/${code.trim()}.${file.trim().split('.').pop().toLowerCase()}`); }); return map; },
    drawMetricChart(element, key, color, formatValue) {
      if (!element) return; const data = this.monthlyMetrics; const width = 520; const height = 155; const margin = { top: 12, right: 12, bottom: 31, left: 45 }; const svg = d3.select(element).attr('viewBox', `0 0 ${width} ${height}`); svg.selectAll('*').remove(); if (!data.length) return;
      const x = d3.scalePoint().domain(data.map((d) => d.key)).range([margin.left, width - margin.right]); const y = d3.scaleLinear().domain([0, d3.max(data, (d) => d[key]) || 1]).nice().range([height - margin.bottom, margin.top]);
      svg.append('g').attr('class', 'chart-grid').attr('transform', `translate(${margin.left},0)`).call(d3.axisLeft(y).ticks(3).tickSize(-(width - margin.left - margin.right)).tickFormat(''));
      const ticks = data.filter((_, i) => data.length <= 8 || i % Math.ceil(data.length / 6) === 0); svg.append('g').attr('class', 'chart-axis').attr('transform', `translate(0,${height - margin.bottom})`).call(d3.axisBottom(x).tickValues(ticks.map((d) => d.key)).tickFormat((keyValue) => this.monthLabel(keyValue).split(' ')[0]));
      const line = d3.line().x((d) => x(d.key)).y((d) => y(d[key])).curve(d3.curveMonotoneX); svg.append('path').datum(data).attr('class', 'chart-area').attr('fill', color).attr('d', `${line(data)} L ${x(data[data.length - 1].key)} ${height - margin.bottom} L ${x(data[0].key)} ${height - margin.bottom} Z`); svg.append('path').datum(data).attr('class', 'chart-line').attr('stroke', color).attr('d', line); svg.selectAll('.chart-point').data(data).join('circle').attr('class', 'chart-point').attr('cx', (d) => x(d.key)).attr('cy', (d) => y(d[key])).attr('r', 3.5).attr('fill', color).append('title').text((d) => `${d.label}: ${formatValue(d[key])}`);
    },
    drawItemsChart() {
      const element = this.$refs.itemsChart; if (!element) return; const data = [...this.productSummary].sort((a, b) => d3.descending(a[this.itemMetric], b[this.itemMetric])).slice(0, 12); const width = 900; const height = 430; const margin = { top: 18, right: 35, bottom: 28, left: 230 }; const svg = d3.select(element).attr('viewBox', `0 0 ${width} ${height}`); svg.selectAll('*').remove(); if (!data.length) return;
      const x = d3.scaleLinear().domain([0, d3.max(data, (d) => d[this.itemMetric]) || 1]).nice().range([margin.left, width - margin.right]); const y = d3.scaleBand().domain(data.map((d) => d.name)).range([margin.top, height - margin.bottom]).padding(.22);
      svg.append('g').attr('class', 'chart-grid horizontal-grid').attr('transform', `translate(0,${height - margin.bottom})`).call(d3.axisBottom(x).ticks(5).tickSize(-(height - margin.top - margin.bottom)).tickFormat('')); svg.append('g').attr('class', 'items-axis').attr('transform', `translate(${margin.left},0)`).call(d3.axisLeft(y).tickSize(0).tickFormat((name) => name.length > 31 ? `${name.slice(0, 31)}…` : name));
      const bars = svg.selectAll('.item-bar').data(data).join('rect').attr('class', 'item-bar').attr('x', margin.left).attr('y', (d) => y(d.name)).attr('height', y.bandwidth()).attr('width', (d) => Math.max(2, x(d[this.itemMetric]) - margin.left)).attr('rx', 5).attr('fill', this.itemMetric === 'quantity' ? '#635bdb' : '#ee8c42');
      bars.on('mousemove', (event, item) => this.showTooltip(event, item)).on('mouseleave', () => { this.tooltip.visible = false; });
      svg.selectAll('.item-image').data(data).join('image').attr('class', 'item-image').attr('href', (d) => d.image || '').attr('x', margin.left - 31).attr('y', (d) => y(d.name) + (y.bandwidth() - 24) / 2).attr('width', 24).attr('height', 24).attr('preserveAspectRatio', 'xMidYMid meet');
      svg.selectAll('.item-value').data(data).join('text').attr('class', 'item-value').attr('x', (d) => x(d[this.itemMetric]) + 8).attr('y', (d) => y(d.name) + y.bandwidth() / 2 + 4).text((d) => this.itemMetric === 'quantity' ? `${this.formatInteger(d.quantity)} шт.` : this.formatCurrency(d.spend));
    },
    showTooltip(event, item) { const rect = this.$refs.itemsChart.getBoundingClientRect(); this.tooltip = { visible: true, x: Math.min(event.clientX - rect.left + 16, rect.width - 330), y: Math.max(12, event.clientY - rect.top - 50), item }; this.$nextTick(() => this.drawPriceTooltip(item)); },
    drawPriceTooltip(item) { const element = this.$refs.priceTooltipChart; if (!element || !item.monthly.length) return; const data = item.monthly; const width = 270; const height = 74; const svg = d3.select(element).attr('viewBox', `0 0 ${width} ${height}`); svg.selectAll('*').remove(); const x = d3.scalePoint().domain(data.map((d) => d.key)).range([4, width - 4]); const y = d3.scaleLinear().domain(d3.extent(data, (d) => d.price)).nice().range([height - 8, 8]); svg.append('path').datum(data).attr('class', 'tooltip-price-line').attr('d', d3.line().x((d) => x(d.key)).y((d) => y(d.price)).curve(d3.curveMonotoneX)); svg.selectAll('circle').data(data).join('circle').attr('cx', (d) => x(d.key)).attr('cy', (d) => y(d.price)).attr('r', 2.5); },
    drawCharts() { this.drawMetricChart(this.$refs.ordersChart, 'orders', '#635bdb', (v) => `${this.formatInteger(v)} заказов`); this.drawMetricChart(this.$refs.spendChart, 'spend', '#ee8c42', (v) => this.formatCurrency(v)); this.drawMetricChart(this.$refs.discountChart, 'discount', '#39a77b', (v) => this.formatCurrency(v)); this.drawItemsChart(); },
  },
  watch: { selectedCategory() { this.$nextTick(() => this.drawCharts()); }, itemMetric() { this.$nextTick(() => this.drawItemsChart()); } },
  async mounted() {
    try { const [dataResponse, imageResponse] = await Promise.all([fetch('data.json'), fetch('image-manifest.json')]); if (!dataResponse.ok) throw new Error(`HTTP ${dataResponse.status}`); const dataset = await dataResponse.json(); if (!dataset.sheets?.[0]) throw new Error('В data.json не найден лист с данными'); this.rows = dataset.sheets[0].rows || []; this.sourceFile = dataset.source_file || 'data.json'; if (imageResponse.ok) this.imagePaths = await imageResponse.json(); }
    catch (e) { this.error = `Не удалось загрузить данные: ${e.message}`; }
    finally { this.loading = false; await this.$nextTick(); this.drawCharts(); }
  },
}).mount('#app');
