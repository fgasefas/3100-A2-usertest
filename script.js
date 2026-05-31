const unpack = (data, key) => data.map(row => row[key]);

const CHART_CONFIG = { responsive: true, displayModeBar: false };

// 第三张图默认勾选显示的国家
// Countries checked by default in the third chart
const defaultGrowthCountries = [
  'Colombia',
  'United States',
  'Australia',
  'Japan',
  'Brazil',
  'Laos',
  'South Africa',
  'Mexico'
];

// 用 d3.csv 读取本地 data 文件夹里的三个 CSV
// Use d3.csv to load the three CSV files from the local data folder
Promise.all([
  d3.csv('data/processed_gap_data.csv', d3.autoType),
  d3.csv('data/bottom40_growth.csv', d3.autoType),
  d3.csv('data/country_summary.csv', d3.autoType)
]).then(([gapData, growthData, countrySummary]) => {
  buildCountryDropdown(gapData, countrySummary);
  drawMap(gapData);
  drawLineChart(gapData, 'Australia');
  buildGrowthCountrySelect(growthData);
  drawGrowthChart(growthData, defaultGrowthCountries);
}).catch(error => {
  console.error(error);
  document.body.insertAdjacentHTML('afterbegin', '<div class="card" style="margin:20px auto;max-width:900px;color:rgb(154, 52, 18)">Data could not be loaded. Please open this folder using VS Code Live Server, not by double-clicking index.html.</div>');
});

// 生成第二张图使用的国家下拉菜单，与 index.html 里的 countrySelect 联动
// Generate the country dropdown used by the second chart, connected to countrySelect in index.html
// 用户切换国家后调用 drawLineChart() 更新折线图和下方说明文字
// When the user changes country, drawLineChart() is called to update the line chart and the explanation text below
function buildCountryDropdown(gapData, countrySummary){
  const select = document.getElementById('countrySelect');

  // 从 country_summary.csv 里筛选出时间跨度至少 10 年的国家避免数据量不够
  // Filter countries from country_summary.csv with at least 10 years of data to avoid having too little data
  // 然后把这些国家写入 index.html 里的 countrySelect 下拉菜单供用户切换国家
  // Then write these countries into the countrySelect dropdown in index.html so users can switch countries
  const countries = countrySummary
    .filter(row => row.StartYear && row.EndYear && row.EndYear - row.StartYear >= 10)
    .sort((a, b) => d3.ascending(a.Entity, b.Entity));

  countries.forEach(row => {
    const option = document.createElement('option');
    option.value = row.Entity;
    option.textContent = row.Entity;
    select.appendChild(option);
  });

  // 默认Australia
  // Default to Australia
  if (countries.some(row => row.Entity === 'Australia')) {
    select.value = 'Australia';
  }

  select.addEventListener('change', event => {
    drawLineChart(gapData, event.target.value);
  });
}

function drawMap(gapData){
  // Choropleth 平均收入
  // Choropleth map for average income
  // 某些国家缺少年份时，下面的 getMapRowsForYear() 会用此前最近的数据补上
  // When some countries are missing data for a year, getMapRowsForYear() below fills it with the nearest available data
  const allYears = [...new Set(gapData.map(row => row.Year))].sort((a, b) => a - b);
  const availableYears = allYears.filter(year =>
    gapData.some(row => row.Year === year && row.Code && row.Mean > 0)
  );

  const latestYear = availableYears[availableYears.length - 1];

  function getMapRowsForYear(year){
    // 地图按年份切换时不是所有国家都每年有记录
    // When the map switches by year, not every country has a record for every year
    // 所以先找该年份之前最近的数据，如果之前没有就找之后最近的数据
    // So the code first finds the nearest data before that year, and if none exists, it finds the nearest data after that year
    const nearestByCode = new Map();

    gapData.forEach(row => {
      if (!row.Code || !row.Mean || row.Mean <= 0) return;

      const oldRow = nearestByCode.get(row.Code);
      const distance = Math.abs(row.Year - year);
      const oldDistance = oldRow ? Math.abs(oldRow.Year - year) : Infinity;

      if (!oldRow || distance < oldDistance) {
        nearestByCode.set(row.Code, row);
      }
    });

    return Array.from(nearestByCode.values());
  }

  const dataForYear = getMapRowsForYear(latestYear);

  const trace = {
    type: 'choropleth',
    locations: unpack(dataForYear, 'Code'),
    z: unpack(dataForYear, 'Mean'),
    zmin: 0,
    zmax: 100,
    text: unpack(dataForYear, 'Entity'),
    // customdata 存真实数据年份，hover 告诉用户这条数据实际来自哪一年
    // customdata stores the real data year, so the hover label tells users which year the data actually comes from
    customdata: unpack(dataForYear, 'Year'),
    locationmode: 'ISO-3',
    colorscale: 'Jet',
    colorbar: {
      title: {
        text: '$/day',
        side: 'right'
      }
    },
    marker: { line: { color: 'rgb(255, 255, 255)', width: 0.4 } },
    hovertemplate: '<b>%{text}</b><br>Average: $%{z:.2f} per day<br>Data year: %{customdata}<extra></extra>'
  };

  const frames = availableYears.map(year => {
    const rows = getMapRowsForYear(year);
    return {
      name: String(year),
      data: [{
        locations: unpack(rows, 'Code'),
        z: unpack(rows, 'Mean'),
        zmin: 0,
        zmax: 100,
        text: unpack(rows, 'Entity'),
        // frame 也要同步传真实数据的年份，不然拖动年份后 hover 无法显示数据来自哪一年
        // The frame also needs the real data year, otherwise the hover label cannot show which year the data comes from after dragging the slider
        customdata: unpack(rows, 'Year')
      }],
      // 用户拖动地图年份 slider 时，同步更新标题年份
      // When the user drags the map year slider, the title year is updated at the same time
      layout: {
        title: { text: `Average daily income/consumption, ${year}`, x: 0.02 }
      }
    };
  });

  const sliderSteps = availableYears.map(year => ({
    label: String(year),
    method: 'animate',
    args: [[String(year)], { mode: 'immediate', frame: { duration: 300, redraw: true }, transition: { duration: 250 } }]
  }));

  const layout = {
    // 地图区域使用较小边距，让世界地图尽量占满卡片空间，slider 的位置由 sliders 设置控制
    // The map area uses small margins so the world map fills the card as much as possible, while the slider position is controlled by sliders
    margin: { l: 0, r: 0, t: 30, b: 0 },
    paper_bgcolor: 'rgb(255, 255, 255)',
    plot_bgcolor: 'rgb(255, 255, 255)',
    geo: {
      projection: { type: 'natural earth' },
      showframe: false,
      showcoastlines: false,
      showocean: true,
      oceancolor: 'rgb(228, 241, 248)',
      showland: true,
      landcolor: 'rgb(244, 246, 248)',
      showcountries: true,
      countrycolor: 'rgb(255, 255, 255)',
      bgcolor: 'rgb(255, 255, 255)'
    },
    // 初始标题显示默认打开的年份，后续年份由上面的 frame.layout 自动更新
    // The initial title shows the default opening year, and later years are updated by frame.layout above
    title: { text: `Average daily income/consumption in ${latestYear}`, x: 0.02 },
    sliders: [{
      active: availableYears.length - 1,
      currentvalue: { prefix: 'Year: ' },
      x: 0.03,
      pad: { t: 35, b: 25 },
      y: -0.08,
      steps: sliderSteps
    }]
  };

  Plotly.newPlot('mapChart', [trace], layout, CHART_CONFIG).then(() => {
    Plotly.addFrames('mapChart', frames);
  });
}

// 绘制第二张图，与 index.html 里的 countrySelect 下拉框和 lineChart 容器联动
// Draw the second chart, connected to the countrySelect dropdown and lineChart container in index.html
// 用户选择不同国家后，这个函数会重新绘制 mean、median 和 ordinary-life gap
// After the user selects a different country, this function redraws the mean, median and ordinary-life gap
function drawLineChart(gapData, country){
  const rows = gapData
    .filter(row => row.Entity === country && row.Mean > 0 && row.Median > 0)
    .sort((a, b) => a.Year - b.Year);

  const years = unpack(rows, 'Year');
  const mean = unpack(rows, 'Mean');
  const median = unpack(rows, 'Median');
  const gap = unpack(rows, 'Gap');

  const meanTrace = {
    x: years,
    y: mean,
    name: 'Average income (mean)',
    mode: 'lines+markers',
    line: { color: 'rgb(36, 87, 166)', width: 3 },
    marker: { size: 5 },
    // mean 和 median 放在上半部分，用来比较平均水平和典型普通人的生活水平
    // Mean and median are placed in the upper part to compare the average level with the living standard of a typical ordinary person
    xaxis: 'x',
    yaxis: 'y',
    hovertemplate: '<b>' + country + '</b><br>Year: %{x}<br>Mean: $%{y:.2f} per day<extra></extra>'
  };

  const medianTrace = {
    x: years,
    y: median,
    name: 'Typical income (median)',
    mode: 'lines+markers',
    line: { color: 'rgb(68, 168, 90)', width: 3 },
    marker: { size: 5 },
    // median 和 mean 共用上半部分坐标轴，这样用户方便对比
    // Median and mean share the upper axes so users can compare them more easily
    xaxis: 'x',
    yaxis: 'y',
    hovertemplate: '<b>' + country + '</b><br>Year: %{x}<br>Median: $%{y:.2f} per day<extra></extra>'
  };

  const gapTrace = {
    x: years,
    y: gap,
    name: 'Ordinary-life gap',
    mode: 'lines+markers',
    line: { color: 'rgb(119, 119, 119)', width: 2, dash: 'dot' },
    marker: { size: 4 },
    // gap 是 mean - median，含义和收入水平不同所以单独放在下半部分避免和蓝线绿线混在一起造成误解
    // Gap is mean minus median, which has a different meaning from income level, so it is placed separately in the lower part to avoid confusion with the blue and green lines
    xaxis: 'x2',
    yaxis: 'y2',
    hovertemplate: '<b>' + country + '</b><br>Year: %{x}<br>Gap: $%{y:.2f} per day<extra></extra>'
  };

  const last = rows[rows.length - 1];
  const first = rows[0];

  const layout = {
    margin: { l: 65, r: 35, t: 160, b: 65 },
    height: 650,
    hovermode: 'closest',
    title: {
      text: `${country}: mean, median and ordinary-life gap`,
      x: 0.02,
      y: 0.98,
      xanchor: 'left'
    },
    // 用 Plotly 的 grid 把趋势拆成上下两个图
    // Use Plotly grid to split the trend into two charts, one above the other
    // 上图看收入/消费水平，下图只看 mean 和 median 的差距
    // The upper chart shows income or consumption levels, while the lower chart only shows the gap between mean and median
    grid: {
      rows: 2,
      columns: 1,
      pattern: 'independent',
      roworder: 'top to bottom'
    },
    xaxis: { 
      title: '', 
      gridcolor: 'rgb(238, 243, 248)' 
    },

    // 上半部分的左侧纵坐标单位
    // Unit for the left y-axis in the upper part
    yaxis: { 
      title: {
        text: 'Income/consumption ($/day)',
        standoff: 18
      },
      automargin: true,
      gridcolor: 'rgb(238, 243, 248)' 
    },

    xaxis2: { 
      title: 'Year', 
      gridcolor: 'rgb(238, 243, 248)' 
    },

    // 下半部分的左侧纵坐标单位
    // Unit for the left y-axis in the lower part
    yaxis2: { 
      title: {
        text: 'Ordinary-life gap ($/day)',
        standoff: 18
      },
      automargin: true,
      gridcolor: 'rgb(238, 243, 248)' 
    },
    legend: {
      orientation: 'h',
      x: 0.02,
      y: 1.08,
      xanchor: 'left',
      yanchor: 'bottom'
    },
    annotations: [{
      x: last.Year,
      y: last.Mean,
      text: 'Latest average',
      showarrow: true,
      arrowhead: 7,
      ax: -40,
      ay: -40
    }]
  };

  Plotly.newPlot('lineChart', [meanTrace, medianTrace, gapTrace], layout, CHART_CONFIG);

  const gapChange = last.Gap - first.Gap;
  const direction = gapChange >= 0 ? 'wider' : 'narrower';
  document.getElementById('countryInsight').innerHTML = `<b>In ${country}</b>, the ordinary-life gap was $${first.Gap.toFixed(2)} per day in ${first.Year} and $${last.Gap.toFixed(2)} per day in ${last.Year}. That means the distance between average and typical income became <b>${direction}</b> by $${Math.abs(gapChange).toFixed(2)} per day.`;
}

// 生成第三张图上方的国家的 checkbox list，与 index.html 里的 growthCountryChecks 容器联动
// Generate the country checkbox list above the third chart, connected to the growthCountryChecks container in index.html
// 用户勾选或取消国家后重新调用 drawGrowthChart() 更新柱状图
// When the user checks or unchecks a country, drawGrowthChart() is called again to update the bar chart
function buildGrowthCountrySelect(growthData){
  const checkBoxArea = document.getElementById('growthCountryChecks');

  const countries = [...new Set(growthData
    .filter(row => row.Entity && row.TotalGrowth !== null && row.Bottom40Growth !== null)
    .map(row => row.Entity)
  )].sort((a, b) => d3.ascending(a, b));

  countries.forEach(country => {
    const label = document.createElement('label');
    label.className = 'countryCheck';

    const input = document.createElement('input');
    input.type = 'checkbox';
    input.value = country;
    input.checked = defaultGrowthCountries.includes(country);

    const name = document.createElement('span');
    // checkbox 里缩写Democratic Republic of Congo，因为名字太长导致显示重叠
    // Abbreviate Democratic Republic of Congo in the checkbox because the full name is too long and causes overlap
    name.textContent = country === 'Democratic Republic of Congo' ? 'DR Congo' : country;

    label.appendChild(input);
    label.appendChild(name);
    checkBoxArea.appendChild(label);
  });

  function updateGrowthChartFromChecks(){
    const selectedCountries = Array.from(checkBoxArea.querySelectorAll('input:checked')).map(input => input.value);
    drawGrowthChart(growthData, selectedCountries);
  }

  checkBoxArea.addEventListener('change', updateGrowthChartFromChecks);

  const defaultButton = document.getElementById('growthDefault');
  const selectAllButton = document.getElementById('growthSelectAll');
  const clearAllButton = document.getElementById('growthClearAll');

  if (defaultButton) {
    defaultButton.addEventListener('click', () => {
      checkBoxArea.querySelectorAll('input').forEach(input => {
        input.checked = defaultGrowthCountries.includes(input.value);
      });
      updateGrowthChartFromChecks();
    });
  }

  if (selectAllButton) {
    selectAllButton.addEventListener('click', () => {
      checkBoxArea.querySelectorAll('input').forEach(input => {
        input.checked = true;
      });
      updateGrowthChartFromChecks();
    });
  }

  if (clearAllButton) {
    clearAllButton.addEventListener('click', () => {
      checkBoxArea.querySelectorAll('input').forEach(input => {
        input.checked = false;
      });
      updateGrowthChartFromChecks();
    });
  }
}

function drawGrowthChart(growthData, selectedCountries){
  let rows = growthData.filter(row =>
    selectedCountries.includes(row.Entity) &&
    row.TotalGrowth !== null &&
    row.Bottom40Growth !== null
  );

  rows = rows.sort((a, b) => d3.ascending(a.Entity, b.Entity));
  const showJapanAnnotation = rows.some(row => row.Entity === 'Japan');
  const showMexicoAnnotation = rows.some(row => row.Entity === 'Mexico');
  
  if (rows.length === 0) {
    Plotly.newPlot('barChart', [], {
      margin: { l: 55, r: 30, t: 80, b: 60 },
      height: 360,
      xaxis: { visible: false },
      yaxis: { visible: false },
      annotations: [{
        xref: 'paper',
        yref: 'paper',
        x: 0.5,
        y: 0.5,
        text: 'No countries selected.',
        showarrow: false,
        font: { size: 16 }
      }]
    }, CHART_CONFIG);
    return;
  }

  const totalTrace = {
    // 缩写Democratic Republic of Congo，因为名字太长导致显示重叠
    // Abbreviate Democratic Republic of Congo because the full name is too long and causes overlap
    x: unpack(rows, 'Entity').map(country => country === 'Democratic Republic of Congo' ? 'DR Congo' : country),
    y: unpack(rows, 'TotalGrowth'),
    name: 'Total population',
    type: 'bar',
    marker: { color: 'rgb(36, 87, 166)' },
    hovertemplate: '<b>%{x}</b><br>Total population growth: %{y:.2f}%<extra></extra>'
  };

  const bottomTrace = {
    // 缩写Democratic Republic of Congo，因为名字太长导致显示重叠
    // Abbreviate Democratic Republic of Congo because the full name is too long and causes overlap
    x: unpack(rows, 'Entity').map(country => country === 'Democratic Republic of Congo' ? 'DR Congo' : country),
    y: unpack(rows, 'Bottom40Growth'),
    name: 'Bottom 40%',
    type: 'bar',
    marker: { color: 'rgb(68, 168, 90)' },
    hovertemplate: '<b>%{x}</b><br>Bottom 40% growth: %{y:.2f}%<extra></extra>'
  };

  const layout = {
    barmode: 'group',
    margin: { l: 55, r: 30, t: 125, b: 80 },
    height: 520,
    title: {
      text: 'Income/consumption growth: total population vs bottom 40%',
      x: 0.02,
      y: 0.97,
      xanchor: 'left'
    },
    // 第三张柱状图的左侧纵坐标，总人口和底层40%人群的年增长率，单位是百分比
    // The left y-axis of the third bar chart shows the annual growth rate for the total population and the bottom 40%, with percentage as the unit
    yaxis: { 
      title: {
        text: 'Annual growth rate (%)',
        standoff: 18
      },
      automargin: true,
      zeroline: true,
      gridcolor: 'rgb(238, 243, 248)' 
    },
    xaxis: { tickangle: 0, automargin: true },
    legend: {
      orientation: 'h',
      x: 0.02,
      y: 1.18,
      xanchor: 'left',
      yanchor: 'bottom'
    },
    // 第三张图的文字注释会跟着 checkbox 联动：只有对应国家被勾选时才显示对应说明
    // The text annotations in the third chart are connected to the checkboxes, so each note only appears when its country is checked
    // Japan 用来指出整体增长为正但底层40%下降，Mexico 用来指出底层40%获得的增长比整体更高
    // Japan is used to show overall growth being positive while the bottom 40% declined, and Mexico is used to show the bottom 40% gaining more growth than the total population
    annotations: [
      ...(showJapanAnnotation ? [{
        x: 'Japan',
        y: 0.5,
        text: 'In Japan:<br>overall living standards rose,<br>but the bottom 40% fell',
        showarrow: true,
        arrowhead: 3,
        ax: 15,
        ay: -100,
        align: 'left'
      }] : []),
      ...(showMexicoAnnotation ? [{
        x: 'Mexico',
        y: 3.7,
        text: 'In Mexico:<br>lower-income people shared<br>in the country\'s growth',
        showarrow: true,
        arrowhead: 3,
        ax: -40,
        ay: -70,
        align: 'left'
      }] : [])
    ]
  };

  Plotly.newPlot('barChart', [totalTrace, bottomTrace], layout, CHART_CONFIG);
}
