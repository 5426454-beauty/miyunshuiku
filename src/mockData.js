// 各 Tab 的 Mock 数据集（含 chartType / renderType 控制图表差异）

const _genDates = (startDate, count) =>
  Array.from({ length: count }, (_, i) => {
    const d = new Date(startDate)
    d.setDate(d.getDate() + i)
    return `${d.getMonth() + 1}/${d.getDate()}`
  })

export const tabData = {

  // ══════════════════════════════════════
  // 首页 — 双仪表盘 + 面积折线 + 数值格
  // ══════════════════════════════════════
  home: {
    left: {
      panel1: {
        title: '水库基本介绍',
        stats: [
          { label: '库区面积',   value: '1000',   unit: 'km²' },
          { label: '正常蓄水位', value: '142.00', unit: 'm' },
          { label: '总库容',    value: '21.80',  unit: '亿m³' },
          { label: '装机容量',  value: '2192',   unit: 'MW' },
        ],
        desc: '水库位于湖北省境内，库区河段长约108km，流域面积16727km²，正常蓄水位142.00m，相应库容21.8亿m³，电站装机容量2192MW，属大（一）型水利枢纽工程。',
      },
      panel2: {
        title: '闸坝管理',
        chartType: 'dual-gauge',
        gaugeA: { value: 68, label: '流量监测', color: '#00d4ff' },
        gaugeB: { value: 34, label: '闸门开度', color: '#00ff88' },
        stats: [
          { label: '本月累计流量',    value: '34.6',  unit: 'm³/s' },
          { label: '本年累计流量',    value: '289.3', unit: 'm³/s' },
          { label: '本月累计调度次数', value: '12',    unit: '次' },
          { label: '高峰期总调度量',  value: '1240',  unit: '万m³' },
        ],
      },
      panel3: {
        title: '库容曲线',
        chartType: 'area-line',
        meta: '近期预测 2026-04-27  库容: 2200m³',
        lineColor: '#00d4ff',
        dates:  _genDates('2026-03-28', 30),
        values: [2200,2180,2210,2250,2300,2280,2320,2350,2400,2380,
                 2420,2460,2440,2480,2500,2520,2490,2510,2530,2550,
                 2520,2480,2460,2440,2420,2400,2380,2360,2340,2200],
        yMin: 2000,
      },
    },
    right: {
      panel1: {
        title: '供水监测',
        renderType: 'grid',
        items: [
          { label: 'PH',   value: '7.2',  unit: '' },
          { label: '浊度',  value: '1500', unit: 'NTU' },
          { label: '电导率', value: '300',  unit: 'μS/cm' },
          { label: '溶解氧', value: '8.5',  unit: 'mg/L' },
          { label: 'COD',  value: '1.8',  unit: 'mg/L' },
          { label: '氨氮',  value: '0.15', unit: 'mg/L' },
          { label: '总磷',  value: '1200', unit: 'μg/L' },
          { label: '总氮',  value: '0.8',  unit: 'mg/L' },
        ],
        badge: { text: '水质: 优', color: '#00ff88' },
      },
      panel2: {
        title: '安全监测',
        score: 94.6,
        scoreLabel: '安全综合分',
        scoreColor: '#00d4ff',
        metrics: [
          { label: '目标完成率', value: '92.35', color: '#00ff88' },
          { label: '安全覆盖',  value: '88.60', color: '#00ff88' },
          { label: '预警能力',  value: '97.52', color: '#00d4ff' },
          { label: '金属检测',  value: '93.52', color: '#00ff88' },
        ],
      },
      panel3: {
        title: '安全事件',
        renderType: 'event-list',
        events: [
          { icon: '📹', title: '安防覆盖率', desc: '15 / 72 个点位', rate: '87%', color: '#00d4ff' },
          { icon: '🛡', title: '安全监察率', desc: '40 / 78 项合规', rate: '92%', color: '#00ff88' },
          { icon: '⚠', title: '告警响应率', desc: '18 / 72 次处置', rate: '75%', color: '#f5c842' },
        ],
      },
    },
  },

  // ══════════════════════════════════════
  // 四全 — 雷达图 + 面积折线 + 数值格
  // ══════════════════════════════════════
  siQuan: {
    left: {
      panel1: {
        title: '全域覆盖概况',
        showSurveillanceBtn: true,
        stats: [
          { label: '监测站点总数', value: '128',  unit: '个' },
          { label: '在线站点',    value: '121',  unit: '个' },
          { label: '覆盖面积',    value: '1680', unit: 'km²' },
          { label: '数据采集频次', value: '15',   unit: 'min' },
        ],
        desc: '全域监测体系覆盖库区主干及支流共128个站点，实现水位、流量、雨量、水质多维度全天候采集，在线率94.5%，构建全要素覆盖监测网络。',
      },
      panel2: {
        title: '监测维度评估',
        chartType: 'radar',
        // 雷达图 6 维度
        indicators: [
          { name: '空间覆盖', max: 100 },
          { name: '时间连续', max: 100 },
          { name: '数据完整', max: 100 },
          { name: '传输可靠', max: 100 },
          { name: '在线稳定', max: 100 },
          { name: '响应速度', max: 100 },
        ],
        values: [91, 97, 88, 95, 94, 89],
        radarColor: '#00d4ff',
        stats: [
          { label: '设备在线率',   value: '94.5', unit: '%' },
          { label: '本月新增站点', value: '3',    unit: '个' },
          { label: '故障设备数',   value: '7',    unit: '台' },
          { label: '待维护设备',   value: '12',   unit: '台' },
        ],
      },
      panel3: {
        title: '在线站点趋势',
        chartType: 'area-line',
        meta: '近30天在线站点数变化',
        lineColor: '#00e5a0',
        dates:  _genDates('2026-03-28', 30),
        values: [112,115,114,118,120,119,121,118,122,121,
                 123,121,120,122,123,124,121,123,124,125,
                 123,122,124,121,120,122,123,121,122,121],
        yMin: 100,
      },
    },
    right: {
      panel1: {
        title: '站点类型分布',
        renderType: 'grid',
        items: [
          { label: '水位站', value: '42',  unit: '个' },
          { label: '流量站', value: '28',  unit: '个' },
          { label: '雨量站', value: '35',  unit: '个' },
          { label: '水质站', value: '23',  unit: '个' },
          { label: '泥沙站', value: '8',   unit: '个' },
          { label: '蒸发站', value: '6',   unit: '个' },
          { label: '地下水', value: '10',  unit: '个' },
          { label: '综合站', value: '14',  unit: '个' },
        ],
        badge: { text: '覆盖: 良好', color: '#00d4ff' },
      },
      panel2: {
        title: '覆盖指数',
        score: 89.2,
        scoreLabel: '全域覆盖综合指数',
        scoreColor: '#00e5a0',
        metrics: [
          { label: '空间覆盖率', value: '91.4', color: '#00ff88' },
          { label: '时间连续性', value: '96.8', color: '#00d4ff' },
          { label: '数据完整率', value: '88.3', color: '#00ff88' },
          { label: '传输可靠率', value: '94.7', color: '#00d4ff' },
        ],
      },
      panel3: {
        title: '覆盖异常事件',
        renderType: 'event-list',
        events: [
          { icon: '📡', title: '信号中断站点', desc: '7 / 128 个离线', rate: '94%', color: '#00d4ff' },
          { icon: '🔋', title: '低电量设备',   desc: '12 / 128 台低电', rate: '82%', color: '#f5c842' },
          { icon: '🌧', title: '雨量超阈站点', desc: '3 / 35 个超限',  rate: '91%', color: '#00ff88' },
        ],
      },
    },
  },

  // ══════════════════════════════════════
  // 四制 — 水平条形图 + 面积折线 + 进度条
  // ══════════════════════════════════════
  siZhi: {
    left: {
      panel1: {
        title: '制度执行概况',
        stats: [
          { label: '制度总数',  value: '86',   unit: '项' },
          { label: '本月执行',  value: '72',   unit: '项' },
          { label: '执行率',   value: '83.7', unit: '%' },
          { label: '未完成项', value: '14',   unit: '项' },
        ],
        desc: '制度管理体系涵盖巡查、检测、应急、档案等86项制度，本月完成72项，执行率83.7%，较上月提升2.1个百分点，重点制度执行率达100%。',
      },
      panel2: {
        title: '各类制度执行率',
        chartType: 'hbar',
        items: [
          { label: '应急制度', value: 100, color: '#00ff88' },
          { label: '报告制度', value: 95,  color: '#00d4ff' },
          { label: '检测制度', value: 91,  color: '#00d4ff' },
          { label: '考核制度', value: 88,  color: '#00d4ff' },
          { label: '巡查制度', value: 84,  color: '#f5c842' },
          { label: '运维制度', value: 82,  color: '#f5c842' },
          { label: '档案制度', value: 78,  color: '#f5c842' },
          { label: '培训制度', value: 70,  color: '#ff8c42' },
        ],
      },
      panel3: {
        title: '制度执行率趋势',
        chartType: 'area-line',
        meta: '近30天执行率变化 (%)',
        lineColor: '#a78bfa',
        dates:  _genDates('2026-03-28', 30),
        values: [75,76,77,75,78,80,79,81,80,82,
                 81,83,82,83,84,82,83,81,82,83,
                 82,81,83,82,84,83,84,83,84,84],
        yMin: 60,
      },
    },
    right: {
      panel1: {
        title: '制度分类执行进度',
        renderType: 'progress',
        items: [
          { label: '应急响应制度', value: 100, color: '#00ff88' },
          { label: '定期报告制度', value: 95,  color: '#00d4ff' },
          { label: '检测检验制度', value: 91,  color: '#00d4ff' },
          { label: '考核评估制度', value: 88,  color: '#00d4ff' },
          { label: '日常巡查制度', value: 84,  color: '#f5c842' },
          { label: '设施运维制度', value: 82,  color: '#f5c842' },
          { label: '档案管理制度', value: 78,  color: '#f5c842' },
          { label: '人员培训制度', value: 70,  color: '#ff8c42' },
        ],
        badge: { text: '合规: 达标', color: '#f5c842' },
      },
      panel2: {
        title: '合规指数',
        score: 83.7,
        scoreLabel: '制度执行综合指数',
        scoreColor: '#a78bfa',
        metrics: [
          { label: '重点制度率', value: '100',  color: '#00ff88' },
          { label: '巡查完成率', value: '84.4', color: '#00d4ff' },
          { label: '整改完成率', value: '82.6', color: '#f5c842' },
          { label: '档案合规率', value: '78.2', color: '#f5c842' },
        ],
      },
      panel3: {
        title: '制度预警事件',
        renderType: 'event-list',
        events: [
          { icon: '📋', title: '逾期未执行制度', desc: '14 / 86 项未完成', rate: '84%', color: '#f5c842' },
          { icon: '🔍', title: '问题整改进度',   desc: '19 / 23 项已整改', rate: '83%', color: '#00ff88' },
          { icon: '📁', title: '档案缺失统计',   desc: '8 / 150 份缺失',  rate: '95%', color: '#00d4ff' },
        ],
      },
    },
  },

  // ══════════════════════════════════════
  // 四预 — 双仪表盘 + 柱状图 + 状态标签
  // ══════════════════════════════════════
  siYu: {
    left: {
      panel1: {
        title: '预警预报概况',
        stats: [
          { label: '本月预警总数', value: '47',   unit: '次' },
          { label: '已处置',      value: '43',   unit: '次' },
          { label: '处置率',      value: '91.5', unit: '%' },
          { label: '当前活跃',    value: '4',    unit: '条' },
        ],
        desc: '本月共触发预警47次：蓝色32次、黄色11次、橙色4次，已处置43次，处置率91.5%，当前4条活跃预警持续跟踪中，无红色预警记录。',
      },
      panel2: {
        title: '预警处置能力',
        chartType: 'dual-gauge',
        gaugeA: { value: 92, label: '处置率',    color: '#00ff88' },
        gaugeB: { value: 56, label: '当前活跃',  color: '#f5c842' },
      },
      panel3: {
        title: '预案管理',
        chartType: 'plan-list',
        plans: [
          {
            id: 'plan-001',
            title: '防汛应急预案',
            level: 'Ⅰ级',
            levelColor: '#ff3333',
            date: '2025-06-15',
            status: '已备案',
            statusColor: '#00ff88',
            content: `<div class="plan-doc">
<h3>五一水库防汛应急预案</h3>
<p><b>预案编号：</b>WY-FX-2025-001</p>
<p><b>编制单位：</b>五一水库管理处</p>
<p><b>备案日期：</b>2025年6月15日</p>
<p><b>适用范围：</b>本预案适用于五一水库及其下游影响区域的洪水灾害防御工作。</p>
<hr/>
<h4>一、总则</h4>
<p>1.1 编制目的：为有效防御洪水灾害，最大限度减少人员伤亡和财产损失，保障水库安全运行及下游人民群众生命财产安全。</p>
<p>1.2 编制依据：《中华人民共和国防洪法》《水库大坝安全管理条例》《国家防汛抗旱应急预案》及湖北省相关地方性法规。</p>
<p>1.3 工作原则：以防为主、防抗结合；统一指挥、分级负责；快速反应、协同应对。</p>
<h4>二、防汛组织机构</h4>
<p>2.1 成立水库防汛指挥部，由水库管理处处长任指挥长，下设综合协调组、工程技术组、物资保障组、抢险救援组、信息宣传组。</p>
<p>2.2 明确各级责任人，签订防汛责任书，严格落实24小时值班制度（汛期5月1日至10月31日）。</p>
<h4>三、预警分级与响应</h4>
<p>3.1 蓝色预警（Ⅳ级）：当预报库区24小时降雨量达到50mm，或库水位达到汛限水位（140.00m）时启动。</p>
<p>3.2 黄色预警（Ⅲ级）：当预报库区24小时降雨量达到100mm，或库水位超过汛限水位0.5m时启动。</p>
<p>3.3 橙色预警（Ⅱ级）：当预报库区24小时降雨量达到150mm，或库水位超过汛限水位1.0m时启动。</p>
<p>3.4 红色预警（Ⅰ级）：当预报库区24小时降雨量达到200mm，或库水位达到设计洪水位（144.50m）时启动。</p>
<h4>四、应急响应措施</h4>
<p>4.1 蓝色响应：加强巡查频次至每4小时一次，开启泄洪闸预泄腾库容。</p>
<p>4.2 黄色响应：巡查频次加密至每2小时一次，开启全部泄洪设施，通知下游沿岸乡镇做好转移准备。</p>
<p>4.3 橙色响应：全员到岗24小时值守，开启非常溢洪道，下游危险区域人员立即转移。</p>
<p>4.4 红色响应：启动Ⅰ级应急响应，全面进入防汛紧急状态，请求上级增援，保障大坝主体安全。</p>
<h4>五、物资储备</h4>
<p>编织袋50000条、砂石料5000m³、块石3000m³、铅丝笼2000个、救生衣500件、应急照明灯100套、发电机5台、应急通讯设备30套。</p>
<h4>六、预案演练与修订</h4>
<p>每年汛前（4月30日前）完成一次防汛应急演练。预案每3年修订一次，遇重大变化及时修订。</p>
</div>`,
          },
          {
            id: 'plan-002',
            title: '大坝安全管理应急预案',
            level: 'Ⅰ级',
            levelColor: '#ff3333',
            date: '2025-03-20',
            status: '已备案',
            statusColor: '#00ff88',
            content: `<div class="plan-doc">
<h3>五一水库大坝安全管理应急预案</h3>
<p><b>预案编号：</b>WY-DB-2025-002</p>
<p><b>编制单位：</b>五一水库管理处</p>
<p><b>备案日期：</b>2025年3月20日</p>
<hr/>
<h4>一、总则</h4>
<p>1.1 编制目的：为提高大坝突发事件应急处置能力，保障大坝安全运行，防范和减少大坝安全事故造成的损失。</p>
<p>1.2 大坝基本情况：混凝土重力坝，最大坝高78m，坝顶高程146.00m，坝顶长度520m，设计洪水位144.50m，校核洪水位145.80m。</p>
<h4>二、风险分析</h4>
<p>2.1 主要风险源：超标准洪水、地震、坝体渗漏、坝基渗透破坏、闸门启闭故障、滑坡涌浪。</p>
<p>2.2 溃坝影响范围：下游影响涉及3个县市12个乡镇，影响人口约18万人，淹没面积约420km²。</p>
<h4>三、监测与预警</h4>
<p>3.1 监测项目：坝体位移（32个测点）、渗流压力（48个测点）、渗流量（12个量水堰）、环境量（水位、水温、气温、降雨量）。</p>
<p>3.2 预警阈值：日渗流量超100L/s，单点位移速率超0.5mm/d，坝基扬压力超设计值15%时触发预警。</p>
<h4>四、应急处置措施</h4>
<p>4.1 渗漏险情：降低库水位，查明渗漏通道，采用土工膜、黏土铺盖等封堵措施，必要时进行灌浆加固。</p>
<p>4.2 滑坡险情：立即降低库水位至安全高程，对滑坡体进行削坡减载，设置抗滑桩。</p>
<p>4.3 闸门故障：启动备用电源，切换手动操作模式，联系专业潜水队伍进行水下检修。</p>
<h4>五、人员转移方案</h4>
<p>5.1 预警发布后30分钟内启动下游人员转移，按"先人员后财产、先老弱病残后一般人员"的原则组织。</p>
<p>5.2 设置避难场所12处，可容纳35000人。转移路线共6条，总长度约85km。</p>
</div>`,
          },
          {
            id: 'plan-003',
            title: '洪水调度方案',
            level: 'Ⅱ级',
            levelColor: '#ff8c42',
            date: '2025-05-01',
            status: '审批中',
            statusColor: '#f5c842',
            content: `<div class="plan-doc">
<h3>五一水库洪水调度方案</h3>
<p><b>方案编号：</b>WY-DD-2025-003</p>
<p><b>编制单位：</b>五一水库管理处</p>
<p><b>编制日期：</b>2025年5月1日</p>
<hr/>
<h4>一、调度原则</h4>
<p>1.1 确保大坝安全为首要目标，兼顾下游防洪安全和兴利效益。</p>
<p>1.2 洪水调度实行"分级负责、统一调度"的原则，严格执行上级防汛指挥机构的调度指令。</p>
<h4>二、防洪特征水位</h4>
<p>2.1 汛限水位：140.00m（5月1日-10月31日）</p>
<p>2.2 正常蓄水位：142.00m</p>
<p>2.3 设计洪水位：144.50m（P=0.1%）</p>
<p>2.4 校核洪水位：145.80m（P=0.01%）</p>
<h4>三、泄洪设施</h4>
<p>3.1 表孔泄洪闸：3孔，单孔净宽10m，堰顶高程133.00m，最大总泄量3200m³/s。</p>
<p>3.2 底孔泄洪洞：2孔，断面4m×5m，进口底槛高程115.00m，最大总泄量800m³/s。</p>
<p>3.3 非常溢洪道：宽150m，堰顶高程144.50m，最大泄量6500m³/s。</p>
<h4>四、调度规则</h4>
<p><b>工况一（库水位≤140.00m）：</b>不泄洪，来水全部拦蓄。</p>
<p><b>工况二（140.00m＜库水位≤142.00m）：</b>控制出库流量等于入库流量，维持库水位不再上涨。</p>
<p><b>工况三（142.00m＜库水位≤144.50m）：</b>逐步加大泄量，按下游河道安全泄量（800m³/s）控制。</p>
<p><b>工况四（库水位＞144.50m）：</b>所有泄洪设施全开敞泄，确保大坝安全。</p>
<h4>五、闸门操作顺序</h4>
<p>5.1 先开启底孔泄洪洞，再开启表孔泄洪闸（由中间孔向两侧依次开启）。</p>
<p>5.2 关闭顺序与开启顺序相反，先关表孔后关底孔，避免下游流量骤减。</p>
<p>5.3 每次闸门操作幅度不超过0.5m，间隔时间不少于10分钟。</p>
</div>`,
          },
          {
            id: 'plan-004',
            title: '地震应急预案',
            level: 'Ⅱ级',
            levelColor: '#ff8c42',
            date: '2025-04-10',
            status: '已备案',
            statusColor: '#00ff88',
            content: `<div class="plan-doc">
<h3>五一水库地震应急预案</h3>
<p><b>预案编号：</b>WY-DZ-2025-004</p>
<p><b>编制单位：</b>五一水库管理处</p>
<p><b>备案日期：</b>2025年4月10日</p>
<hr/>
<h4>一、总则</h4>
<p>1.1 编制目的：建立健全水库地震灾害应急响应机制，确保地震发生后能迅速、有序、高效地开展应急处置工作。</p>
<p>1.2 库区地震背景：水库位于鄂西北褶皱带，坝址区地震基本烈度为Ⅶ度，设计地震加速度0.10g。</p>
<h4>二、地震监测</h4>
<p>2.1 布设强震监测台网：坝顶2台、坝基2台、两岸坝肩各1台、自由场1台，共7台强震仪。</p>
<p>2.2 实时传输至水库管理中心和省级地震监测中心，触发阈值设定为0.025g。</p>
<h4>三、应急响应分级</h4>
<p>3.1 Ⅳ级响应（有感地震）：震级M＜4.0，或烈度＜Ⅴ度。加密巡查，检查坝体外观。</p>
<p>3.2 Ⅲ级响应（中等地震）：震级4.0≤M＜5.0，或烈度Ⅴ-Ⅵ度。全面检查坝体、泄洪设施、监测仪器。</p>
<p>3.3 Ⅱ级响应（强震）：震级5.0≤M＜6.0，或烈度Ⅶ-Ⅷ度。降低库水位至安全高程，组织专家会商评估坝体安全。</p>
<p>3.4 Ⅰ级响应（大震）：震级M≥6.0，或烈度≥Ⅸ度。紧急降低库水位，启动下游人员转移，请求省级支援。</p>
<h4>四、震后检查要点</h4>
<p>4.1 坝体：检查裂缝、变形、渗漏、剥落等异常。</p>
<p>4.2 坝基：检查渗流量变化、扬压力变化。</p>
<p>4.3 泄洪设施：检查闸门启闭功能、启闭机运行状态。</p>
<p>4.4 近坝库岸：检查滑坡、崩塌等地质灾害隐患。</p>
<h4>五、应急物资</h4>
<p>应急照明灯50套、卫星电话10部、应急发电车2台、帐篷100顶、医疗急救箱30个、无人机3架（用于震后快速巡查）。</p>
</div>`,
          },
          {
            id: 'plan-005',
            title: '超标准洪水防御预案',
            level: 'Ⅰ级',
            levelColor: '#ff3333',
            date: '2025-07-01',
            status: '已备案',
            statusColor: '#00ff88',
            content: `<div class="plan-doc">
<h3>五一水库超标准洪水防御预案</h3>
<p><b>预案编号：</b>WY-CBZ-2025-005</p>
<p><b>编制单位：</b>五一水库管理处</p>
<p><b>备案日期：</b>2025年7月1日</p>
<hr/>
<h4>一、总则</h4>
<p>1.1 超标准洪水定义：入库洪峰流量超过设计洪水标准（P=0.1%，洪峰流量15800m³/s）的洪水。</p>
<p>1.2 防御目标：发生超标准洪水时，全力确保大坝主体安全，最大限度减轻下游灾害损失。</p>
<h4>二、可能最大洪水（PMF）分析</h4>
<p>2.1 可能最大降水（PMP）：24小时面雨量1200mm。</p>
<p>2.2 可能最大洪水（PMF）：入库洪峰流量约24500m³/s，洪量约18.5亿m³。</p>
<p>2.3 PMF下最高库水位预估约146.20m（低于坝顶149.00m约2.80m）。</p>
<h4>三、泄洪能力评估</h4>
<p>3.1 正常泄洪设施全开（表孔+底孔）：最大总泄量约4000m³/s。</p>
<p>3.2 非常溢洪道启用后总泄量可达10500m³/s。</p>
<p>3.3 PMF工况下最大入库24500m³/s，最大出库10500m³/s，需利用防洪库容调节。</p>
<h4>四、防御措施</h4>
<p>4.1 预泄腾库：收到超标准洪水预报后，提前48小时开始预泄，将库水位降至汛限水位以下2m（138.00m）。</p>
<p>4.2 非常溢洪道启用：库水位达到144.50m且仍快速上涨时，启用非常溢洪道。</p>
<p>4.3 坝顶临时加高：储备沙袋20000条，可在6小时内对坝顶临时加高0.8m。</p>
<h4>五、溃坝应急预案</h4>
<p>5.1 溃坝洪水演进：溃坝最大流量约85000m³/s，下游3小时到达第一个县城，淹没水深3-8m。</p>
<p>5.2 预警发布：通过预警广播系统、短信平台、电视、网络等多渠道同步发布，确保下游15分钟内全覆盖。</p>
<p>5.3 撤离时间窗口：距溃坝发生，下游第一个乡镇有约40分钟撤离时间，县城有约3小时。</p>
<h4>六、培训与演练</h4>
<p>每年组织1次超标准洪水防御桌面推演，每2年组织1次实战演练（含下游人员转移），确保各岗位熟悉应急流程。</p>
</div>`,
          },
        ],
      },
    },
    right: {
      panel1: {
        title: '预报模型状态',
        renderType: 'status-tag',
        items: [
          { label: '洪水预报', status: '运行中', statusColor: '#00ff88' },
          { label: '水位预报', status: '运行中', statusColor: '#00ff88' },
          { label: '旱情预报', status: '待机',   statusColor: '#f5c842' },
          { label: '泥沙预报', status: '运行中', statusColor: '#00ff88' },
          { label: '水质预报', status: '运行中', statusColor: '#00ff88' },
          { label: '冰情预报', status: '停用',   statusColor: '#666' },
          { label: '地质预警', status: '运行中', statusColor: '#00ff88' },
          { label: '气象联动', status: '运行中', statusColor: '#00ff88' },
        ],
        badge: { text: '状态: 正常', color: '#00ff88' },
      },
    },
  },

  // ══════════════════════════════════════
  // 四管 — 水平条形图 + 面积折线 + 状态标签
  // ══════════════════════════════════════
  siGuan: {
    left: {
      panel1: {
        title: '管护任务概况',
        stats: [
          { label: '本月任务总数', value: '156',  unit: '项' },
          { label: '已完成',      value: '138',  unit: '项' },
          { label: '完成率',      value: '88.5', unit: '%' },
          { label: '在建项目',    value: '5',    unit: '个' },
        ],
        desc: '管护体系涵盖日常维护、设施更新、隐患排查等156项任务，已完成138项，设施完好率96.2%，在建项目5个，累计投入工时2840小时。',
      },
      panel2: {
        title: '设施管护完好率',
        chartType: 'hbar',
        items: [
          { label: '大坝主体', value: 98, color: '#00ff88' },
          { label: '监测仪器', value: 96, color: '#00ff88' },
          { label: '闸门设备', value: 95, color: '#00d4ff' },
          { label: '通信线路', value: 94, color: '#00d4ff' },
          { label: '水电站',  value: 92, color: '#00d4ff' },
          { label: '溢洪道',  value: 90, color: '#f5c842' },
          { label: '引水隧洞', value: 72, color: '#ff8c42' },
          { label: '管护道路', value: 68, color: '#ff8c42' },
        ],
      },
      panel3: {
        title: '机器人巡检路线',
        chartType: 'inspection-legend',
        routes: [
          { name: '巡检线路1', color: '#ff3333', status: '巡检中', progress: 73 },
          { name: '巡检线路2', color: '#00ff88', status: '已完成', progress: 100 },
          { name: '巡检线路3', color: '#fb923c', status: '待机中', progress: 0 },
        ],
      },
    },
    right: {
      panel1: {
        title: '设施运行状态',
        renderType: 'status-tag',
        items: [
          { label: '大坝主体', status: '正常', statusColor: '#00ff88' },
          { label: '溢洪道',  status: '正常', statusColor: '#00ff88' },
          { label: '引水隧洞', status: '检修', statusColor: '#f5c842' },
          { label: '水电站',  status: '运行', statusColor: '#00d4ff' },
          { label: '闸门设备', status: '正常', statusColor: '#00ff88' },
          { label: '监测仪器', status: '正常', statusColor: '#00ff88' },
          { label: '通信线路', status: '正常', statusColor: '#00ff88' },
          { label: '管护道路', status: '维护', statusColor: '#ff8c42' },
        ],
        badge: { text: '整体: 良好', color: '#00d4ff' },
      },
      panel2: {
        title: '管护质量指数',
        score: 88.5,
        scoreLabel: '综合管护质量指数',
        scoreColor: '#fb923c',
        metrics: [
          { label: '设施完好率', value: '96.2', color: '#00ff88' },
          { label: '任务完成率', value: '88.5', color: '#00d4ff' },
          { label: '隐患消除率', value: '82.4', color: '#f5c842' },
          { label: '响应及时率', value: '94.1', color: '#00d4ff' },
        ],
      },
      panel3: {
        title: '管护预警事件',
        renderType: 'event-list',
        events: [
          { icon: '🔧', title: '待处理维修项',  desc: '18 / 156 项未完', rate: '88%', color: '#00d4ff' },
          { icon: '⚠',  title: '未消除隐患',   desc: '9 / 54 处待消',  rate: '82%', color: '#f5c842' },
          { icon: '🏗',  title: '在建项目进度', desc: '5 个项目进行中', rate: '60%', color: '#ff8c42' },
        ],
      },
    },
  },
}
