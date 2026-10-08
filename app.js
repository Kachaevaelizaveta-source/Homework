const { createApp } = Vue;

const STATUS_DELIVERED = 'доставлен';

createApp({
  data() {
    return { rows: [], sourceFile: '', catalog: new Map(), loading: true, error: '' };
  },
  computed: {
    deliveredRows() {
      return this.rows.filter((row) => String(row['Статус'] || '').trim().toLowerCase() === STATUS_DELIVERED);
    },
    productRows() {
      return this.deliveredRows.filter((row) => !['доставка', 'упаковка'].includes(String(row['Название позиции'] || '').trim().toLowerCase()));
    },
    uniqueOrders() { return new Set(this.deliveredRows.map((row) => row['Номер заказа'])).size; },
    uniqueProducts() { return new Set(this.productRows.map((row) => row['Название позиции'])).size; },
    totalAmount() { return d3.sum(this.deliveredRows, (row) => Number(row['Сумма']) || 0); },
    totalQuantity() { return d3.sum(this.productRows, (row) => Number(row['Количество товаров']) || 0); },
    averageDiscount() { return d3.mean(this.deliveredRows, (row) => Number(row['Скидка']) || 0) || 0; },
    monthlyMetrics() {
      const groups = d3.group(this.deliveredRows, (row) => this.monthKey(row['Дата заказа']));
      return [...groups].sort(([a], [b]) => d3.ascending(a, b)).map(([key, rows]) => ({
        key,
        label: this.monthLabel(key),
        orders: new Set(rows.map((row) => row['Номер заказа'])).size,
        spend: d3.sum(rows, (row) => Number(row['Сумма']) || 0),
        discount: d3.mean(rows, (row) => Number(row['Скидка']) || 0) || 0,
      }));
    },
    averageMonthlyOrders() { return d3.mean(this.monthlyMetrics, (item) => item.orders) || 0; },
    averageMonthlySpend() { return d3.mean(this.monthlyMetrics, (item) => item.spend) || 0; },
    periodLabel() {
      if (!this.monthlyMetrics.length) return 'нет данных';
      return `${this.monthlyMetrics[0].label} — ${this.monthlyMetrics[this.monthlyMetrics.length - 1].label}`;
    },
    productSummary() {
      const groups = d3.group(this.productRows, (row) => row['Название позиции'] || 'Без названия');
      return [...groups].map(([name, rows]) => ({
        name,
        category: rows[0]['Категория'] || 'Без категории',
        quantity: d3.sum(rows, (row) => Number(row['Количество товаров']) || 0),
        spend: d3.sum(rows, (row) => Number(row['Сумма']) || 0),
        image: this.catalog.get(name) || '',
      }));
    },
    topByQuantity() { return [...this.productSummary].sort((a, b) => d3.descending(a.quantity, b.quantity)).slice(0, 8); },
    topBySpend() { return [...this.productSummary].sort((a, b) => d3.descending(a.spend, b.spend)).slice(0, 8); },
    maxQuantity() { return d3.max(this.topByQuantity, (item) => item.quantity) || 1; },
    maxSpend() { return d3.max(this.topBySpend, (item) => item.spend) || 1; },
    categorySummary() {
      const groups = d3.group(this.productRows, (row) => row['Категория'] || 'Без категории');
      return [...groups].map(([name, rows]) => {
        const products = d3.rollups(rows, (items) => d3.sum(items, (row) => Number(row['Количество товаров']) || 0), (row) => row['Название позиции'] || 'Без названия');
        const topProduct = products.sort((a, b) => d3.descending(a[1], b[1]))[0]?.[0] || '—';
        return { name, quantity: d3.sum(rows, (row) => Number(row['Количество товаров']) || 0), spend: d3.sum(rows, (row) => Number(row['Сумма']) || 0), topProduct };
      }).sort((a, b) => d3.descending(a.spend, b.spend)).map((item) => ({ ...item, share: this.totalAmount ? item.spend / this.totalAmount * 100 : 0 }));
    },
  },
  methods: {
    formatInteger(value) { return d3.format(',.0f')(Number(value) || 0).replaceAll(',', ' '); },
    formatDecimal(value) { return d3.format(',.1f')(Number(value) || 0).replaceAll(',', ' '); },
    formatCurrency(value) { return `${d3.format(',.2f')(Number(value) || 0).replaceAll(',', ' ')} ₽`; },
    monthKey(value) { const date = new Date(value); return Number.isNaN(date.getTime()) ? 'unknown' : d3.timeFormat('%Y-%m')(date); },
    monthLabel(key) { if (key === 'unknown') return '—'; const [year, month] = key.split('-'); return `${['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'][Number(month) - 1]} ${year}`; },
    parseCatalog(csvText) {
      const catalog = new Map();
      const lines = csvText.replace(/^\uFEFF/, '').split(/\r?\n/).filter(Boolean).slice(1);
      lines.forEach((line) => {
        const [code, name, category, file] = line.split(';');
        if (name && file && code) {
          const extension = file.trim().split('.').pop().toLowerCase();
          catalog.set(name.trim(), `products/${code.trim()}.${extension}`);
        }
      });
      return catalog;
    },
    drawMetricChart(element, key, color, formatValue) {
      if (!element || !this.monthlyMetrics.length) return;
      const data = this.monthlyMetrics;
      const width = 520; const height = 155; const margin = { top: 12, right: 12, bottom: 31, left: 45 };
      const svg = d3.select(element).attr('viewBox', `0 0 ${width} ${height}`).attr('preserveAspectRatio', 'none');
      svg.selectAll('*').remove();
      const x = d3.scalePoint().domain(data.map((item) => item.key)).range([margin.left, width - margin.right]);
      const y = d3.scaleLinear().domain([0, d3.max(data, (item) => item[key]) || 1]).nice().range([height - margin.bottom, margin.top]);
      svg.append('g').attr('class', 'chart-grid').attr('transform', `translate(${margin.left},0)`).call(d3.axisLeft(y).ticks(3).tickSize(-(width - margin.left - margin.right)).tickFormat(''));
      svg.append('g').attr('class', 'chart-axis').attr('transform', `translate(0,${height - margin.bottom})`).call(d3.axisBottom(x).tickValues(data.filter((_, index) => data.length < 9 || index % Math.ceil(data.length / 6) === 0).map((item) => item.key)).tickFormat((keyValue) => this.monthLabel(keyValue).split(' ')[0]));
      const line = d3.line().x((item) => x(item.key)).y((item) => y(item[key])).curve(d3.curveMonotoneX);
      svg.append('path').datum(data).attr('class', 'chart-area').attr('fill', color).attr('d', `${line(data)} L ${x(data[data.length - 1].key)} ${height - margin.bottom} L ${x(data[0].key)} ${height - margin.bottom} Z`);
      svg.append('path').datum(data).attr('class', 'chart-line').attr('stroke', color).attr('d', line);
      svg.selectAll('.chart-point').data(data).join('circle').attr('class', 'chart-point').attr('cx', (item) => x(item.key)).attr('cy', (item) => y(item[key])).attr('r', 3.5).attr('fill', color).append('title').text((item) => `${item.label}: ${formatValue(item[key])}`);
    },
    drawCharts() {
      this.drawMetricChart(this.$refs.ordersChart, 'orders', '#635bdb', (value) => `${this.formatInteger(value)} заказов`);
      this.drawMetricChart(this.$refs.spendChart, 'spend', '#ee8c42', (value) => this.formatCurrency(value));
      this.drawMetricChart(this.$refs.discountChart, 'discount', '#39a77b', (value) => this.formatCurrency(value));
    },
  },
  watch: { deliveredRows() { this.$nextTick(() => this.drawCharts()); } },
  async mounted() {
    try {
      const [response, catalogResponse] = await Promise.all([fetch('data.json'), fetch('items/items/positions.csv')]);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const dataset = await response.json();
      const sheet = dataset.sheets?.[0];
      if (!sheet) throw new Error('В data.json не найден лист с данными');
      this.rows = sheet.rows || [];
      this.sourceFile = dataset.source_file || 'data.json';
      if (catalogResponse.ok) this.catalog = this.parseCatalog(await catalogResponse.text());
      await this.$nextTick();
      this.drawCharts();
    } catch (error) { this.error = `Не удалось загрузить данные: ${error.message}`; }
    finally {
      this.loading = false;
      await this.$nextTick();
      this.drawCharts();
    }
  },
}).mount('#app');
