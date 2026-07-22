// 内置 AI 短剧题材预设 —— 应用启动时同步进 genre_presets 表。
// 2026-07 市场快照：优先覆盖 AI 漫剧/仿真人剧热门题材，末尾仅保留少量常青经典。

export interface BuiltInGenrePreset {
  name: string
  description: string
  /** hot = 当前市场主推；classic = 仍有稳定受众的经典保留项 */
  marketTier: 'hot' | 'classic'
  commonRelationships: string[]
  commonHighlights: string[]
  commonReversals: string[]
  commonOpenings: string[]
  commonCliffhangers: string[]
  visualStyle: string
  shotPromptAdvice: string
  aiVideoRisks: string
}

export const BUILT_IN_GENRE_PRESETS: BuiltInGenrePreset[] = [
  {
    name: '奇幻玄幻·修仙逆袭',
    description: '东方神话或修仙体系下，底层主角觉醒血脉、获得传承并完成境界跃迁。',
    marketTier: 'hot',
    commonRelationships: ['废柴弟子 vs 宗门天骄', '传承者 vs 上古势力', '主角 vs 亦敌亦友的同道'],
    commonHighlights: ['境界突破', '血脉觉醒', '越级反杀', '秘境夺宝'],
    commonReversals: ['废柴体质实为上古神体', '师尊才是幕后布局者', '所谓正道隐藏灭世计划'],
    commonOpenings: ['测灵根受辱后异象降临', '斩仙台死局中觉醒', '秘境濒死获得远古传承'],
    commonCliffhangers: ['天劫提前降临', '上界强敌隔空锁定主角', '被封印的真实身世苏醒'],
    visualStyle: '高饱和东方玄幻，云海仙山、法阵灵兽与宏大能量特效并重',
    shotPromptAdvice: '先固定宗门、服饰和法器锚点；突破场景用远景建立奇观，再以眼神和手部特写承接情绪',
    aiVideoRisks: '法器、纹样和角色服饰跨镜头易漂移；多人斗法与复杂粒子特效容易失控',
  },
  {
    name: '游戏系统·副本升级',
    description: '主角绑定任务系统或进入游戏化世界，通过副本、职业与奖励机制持续升级。',
    marketTier: 'hot',
    commonRelationships: ['玩家 vs 系统规则', '队长 vs 临时队友', '主角 vs 排行榜强敌'],
    commonHighlights: ['隐藏职业', '神级奖励', '副本首杀', '数值碾压'],
    commonReversals: ['系统任务在筛选救世者', '队友是隐藏关底角色', '现实世界才是最终副本'],
    commonOpenings: ['全民觉醒当天获得唯一职业', '死亡游戏突然降临', '新手礼包开出禁忌能力'],
    commonCliffhangers: ['系统发布必死任务', '副本难度突然升为神级', '现实身份被榜一玩家识破'],
    visualStyle: '游戏 HUD 与电影化动作结合，技能颜色、职业徽记和副本主题高度区分',
    shotPromptAdvice: '把属性面板作为后期图层而非画面主体；每种技能固定颜色、手势和镜头运动',
    aiVideoRisks: '模型直接生成 UI 文字容易乱码，技能特效连续性和多人战斗空间关系较难稳定',
  },
  {
    name: '末世求生·领地经营',
    description: '灾变、极寒或丧尸世界中，主角囤积资源、建设庇护所并扩张生存领地。',
    marketTier: 'hot',
    commonRelationships: ['领主 vs 资源掠夺者', '幸存者团队内部博弈', '人类聚居地 vs 变异生物'],
    commonHighlights: ['提前囤货', '基地升级', '资源反差', '灾难反杀'],
    commonReversals: ['避难所本身是实验场', '灾变源头来自内部', '被驱逐者掌握唯一解药'],
    commonOpenings: ['重生回灾变前七天', '全球极寒倒计时启动', '主角点燃最后一堆篝火'],
    commonCliffhangers: ['安全区坐标突然曝光', '第二轮灾变预警响起', '基地内部出现感染者'],
    visualStyle: '冷峻废土与温暖庇护所强反差，突出极端天气、物资规模和基地成长',
    shotPromptAdvice: '为基地制作阶段性设定图；灾难镜头以环境远景为主，人物行动用短切近景保证一致性',
    aiVideoRisks: '大规模灾害、尸群和基地连续升级成本高；物资数量及空间布局易前后矛盾',
  },
  {
    name: '悬疑灵异·民俗奇谭',
    description: '围绕谜案、地方禁忌或民俗异闻层层调查，在现实与超自然之间反复翻转。',
    marketTier: 'hot',
    commonRelationships: ['调查者 vs 不可靠证人', '返乡者 vs 守秘村落', '主角 vs 似敌似友的引路人'],
    commonHighlights: ['线索闭环', '身份反转', '民俗解谜', '极限逃生'],
    commonReversals: ['鬼怪是人为伪装', '受害者才是布局者', '主角的记忆是伪造的'],
    commonOpenings: ['失踪者发来死后视频', '返乡参加一场禁忌葬礼', '封存多年的旧案再次发生'],
    commonCliffhangers: ['监控中出现第二个主角', '关键证人说出相反口供', '禁忌仪式还缺最后一人'],
    visualStyle: '写实冷色悬疑融合中式民俗质感，以留白、局部光源和关键物证制造不安',
    shotPromptAdvice: '先建立空间方位再隐藏信息；关键物证固定形状与位置，反转前后复用同一构图',
    aiVideoRisks: '线索道具若跨镜头变化会破坏推理；阴暗画面容易丢失人物五官和场景细节',
  },
  {
    name: '规则怪谈·无限流',
    description: '主角进入受神秘规则支配的副本，通过识别真假条款、利用漏洞完成生存闯关。',
    marketTier: 'hot',
    commonRelationships: ['闯关者 vs 规则制定者', '老玩家 vs 新人', '理性主角 vs 被污染的同伴'],
    commonHighlights: ['识破伪规则', '卡规则漏洞', '副本通关', '身份阵营翻转'],
    commonReversals: ['安全规则才是污染源', '主持人也是被困玩家', '通关会把灾难带回现实'],
    commonOpenings: ['醒来收到七条禁忌', '日常场所突然副本化', '所有人同时听见倒计时'],
    commonCliffhangers: ['规则文本悄然改写', '队友触发隐藏死亡条件', '主角发现自己的名字在禁入名单'],
    visualStyle: '熟悉日常空间的诡异化处理，低饱和底色配单一警示色与重复象征物',
    shotPromptAdvice: '规则文字用清晰后期字幕呈现；重复走廊、钟表和门牌建立固定视觉语法',
    aiVideoRisks: '直接生成长文字易乱码；循环空间与同一怪物形象需要严格的镜头和资产一致性控制',
  },
  {
    name: '都市逆袭·隐藏大佬',
    description: '被轻视的普通人藏有顶级能力或身份，在职场、商业与家庭冲突中连续反制。',
    marketTier: 'hot',
    commonRelationships: ['隐藏大佬 vs 势利上司', '创业者 vs 资本对手', '被背叛者 vs 前伴侣'],
    commonHighlights: ['身份掉马', '商业翻盘', '公开打脸', '实力碾压'],
    commonReversals: ['小人物才是幕后股东', '看似贵人实为旧敌', '失败项目藏着关键技术'],
    commonOpenings: ['庆功宴上被开除', '离婚当天收到巨额订单', '保洁员出手救下濒危公司'],
    commonCliffhangers: ['最高层亲自来接主角', '竞争方亮出更深背景', '主角主动放弃到手的胜利'],
    visualStyle: '现代都市写实风，以身份前后的服装、空间和光线反差放大逆袭快感',
    shotPromptAdvice: '打脸场景先拍压迫者群像，再用主角静态近景和关键凭证特写完成反转',
    aiVideoRisks: '会议和宴会群像角色易混；手机、合同与屏幕内容需后期合成以保证可读性',
  },
  {
    name: '兽态进化·非人主角',
    description: '主角穿越为弱小动物、灵兽或异种，依靠吞噬、进化与族群经营成长为顶级存在。',
    marketTier: 'hot',
    commonRelationships: ['幼兽主角 vs 天敌', '进化者 vs 契约主人', '新族群 vs 原生霸主'],
    commonHighlights: ['形态进化', '血脉返祖', '以弱胜强', '族群扩张'],
    commonReversals: ['最弱物种拥有神兽源血', '饲主是未来宿敌', '进化系统在培养容器'],
    commonOpenings: ['醒来变成一只弱小动物', '被族群驱逐后激活进化面板', '吞下第一枚异变晶核'],
    commonCliffhangers: ['下一形态出现未知分支', '天敌循着血脉气息降临', '主角第一次恢复人类记忆'],
    visualStyle: '高辨识度生物设计结合自然奇观，进化前后保留眼睛、纹样等连续视觉锚点',
    shotPromptAdvice: '先制作各进化阶段角色表；低机位跟拍突出非人视角，进化用轮廓匹配转场',
    aiVideoRisks: '动物肢体和毛发易变形，不同进化阶段若缺乏锚点会被误认为不同角色',
  },
  {
    name: '古风女频·重生复仇',
    description: '主母、弃妇或贵女重回命运节点，以宅斗、权谋与经商手段夺回人生主导权。',
    marketTier: 'hot',
    commonRelationships: ['重生主母 vs 负心夫家', '贵女 vs 偏心宗族', '女主 vs 暗线盟友'],
    commonHighlights: ['提前拆局', '掌家夺权', '公开休夫', '凤位逆袭'],
    commonReversals: ['忠仆掌握前世真相', '盟友也带着前世记忆', '女主主动放弃原定姻缘'],
    commonOpenings: ['重回大婚当日', '棺中醒来听见分家密谋', '上一世的毒酒再次送到面前'],
    commonCliffhangers: ['族谱曝出身世秘密', '宫中懿旨突然赐婚', '前世幕后人提前出手'],
    visualStyle: '精致国风宅院与宫廷质感，色彩随女主权力成长由压抑转为明艳',
    shotPromptAdvice: '为主要角色锁定发饰、纹样和品阶色；宅斗用屏风遮挡、镜面与主观视线强化算计',
    aiVideoRisks: '古装发饰和服纹跨镜头容易漂移；宴席、朝堂等大群像制作难度高',
  },
  {
    name: '年代乡村·经营逆袭',
    description: '主角回到特定年代或扎根乡村，凭手艺、商业判断与邻里协作改善家庭和产业。',
    marketTier: 'hot',
    commonRelationships: ['返乡者 vs 守旧族人', '小经营者 vs 垄断商贩', '夫妻搭档 vs 原生家庭'],
    commonHighlights: ['小生意做大', '手艺变现', '家人悔悟', '带村致富'],
    commonReversals: ['破旧物件藏着关键商机', '竞争者其实在替人背锅', '被嫌弃的手艺成为稀缺资源'],
    commonOpenings: ['重回八十年代分家当天', '洪水围村只剩一处安全地', '返乡接手濒临倒闭的小店'],
    commonCliffhangers: ['第一桶金被人截胡', '关键批文突然作废', '失联亲人带着债务归来'],
    visualStyle: '温暖怀旧写实风，突出年代器物、烟火饮食与乡村四季变化',
    shotPromptAdvice: '建立年代道具白名单；经营成长用固定机位复拍店面和村貌，形成直观前后对比',
    aiVideoRisks: '年代器物容易混入现代元素，方言口型和多人家庭戏的一致性控制要求高',
  },
  {
    name: '萌宝团宠·奇能破局',
    description: '拥有兽语、预知或玄学能力的萌娃进入复杂家庭，以童真视角化解危机并凝聚亲情。',
    marketTier: 'hot',
    commonRelationships: ['萌娃 vs 冷面家主', '萌娃 vs 争宠反派', '萌娃与动物/神秘伙伴'],
    commonHighlights: ['全家团宠', '奶萌预警', '身世揭晓', '小人物救全家'],
    commonReversals: ['童言其实是灾难预言', '反派是被误解的守护者', '萌娃来自未来或异世'],
    commonOpenings: ['小萌娃带着预言上门认亲', '冷宫奶团听懂神兽说话', '被丢弃当天救下首富'],
    commonCliffhangers: ['下一条预言指向至亲', '神秘动物突然开口', '真正的血缘鉴定被送到家门'],
    visualStyle: '明亮治愈底色叠加轻奇幻元素，强调萌娃表情、家庭反差和标志性萌宠',
    shotPromptAdvice: '减少高难度儿童全身动作，更多使用反应近景、成人视线反打和萌宠插镜',
    aiVideoRisks: '儿童形象与年龄跨镜头易漂移；儿童、动物同框动作及口型生成风险较高',
  },
  {
    name: '恋综娱乐圈·穿越逆袭',
    description: '主角穿越、重生或遭事业背叛后进入恋综/娱乐圈，在镜头前完成情感与口碑翻盘。',
    marketTier: 'hot',
    commonRelationships: ['素人嘉宾 vs 顶流明星', '前任 vs 新搭档', '真实自我 vs 节目人设'],
    commonHighlights: ['直播掉马', '全网真香', '舞台翻盘', '双向选择'],
    commonReversals: ['黑红嘉宾才是节目投资人', '心动对象带着任务入场', '恶剪素材意外还原真相'],
    commonOpenings: ['被前任抛弃后空降恋综', '全网黑当天绑定直播系统', '穿成恋综第一轮就被淘汰的炮灰'],
    commonCliffhangers: ['匿名心动短信来自意外的人', '直播镜头拍到幕后交易', '节目组临时加入前任修罗场'],
    visualStyle: '明快综艺感融合社交媒体界面，海岛、营地、舞台等场景突出群像与时尚感',
    shotPromptAdvice: '固定每位嘉宾的代表色和座位关系；直播评论、热搜和票数统一用后期动态图层',
    aiVideoRisks: '多嘉宾同框容易串脸，综艺 UI 与弹幕文字直接生成会失真，时尚造型需严格锁定',
  },
  {
    name: '乙女游戏·多男主攻略',
    description: '女主进入乙女游戏或任务世界，在多条角色线中提升好感、破解黑化与世界崩坏危机。',
    marketTier: 'hot',
    commonRelationships: ['唯一女主 vs 多位攻略对象', '玩家 vs 引导系统', '温柔表象 vs 黑化人格'],
    commonHighlights: ['好感暴涨', '修罗场', '隐藏路线', '反攻略'],
    commonReversals: ['所有攻略对象都保留轮回记忆', '系统才是最终攻略目标', '女主选择退出预设感情线'],
    commonOpenings: ['穿进乙游成为必死恶役', '系统把所有角色好感调成负数', '第一位攻略对象提前黑化'],
    commonCliffhangers: ['隐藏角色解锁', '好感面板集体归零', '现实中的熟人出现在游戏世界'],
    visualStyle: '高精度幻想恋爱视觉，每位男主拥有独立色彩、场景母题与光影气质',
    shotPromptAdvice: '角色分线分别锁定色板和构图；好感提示使用后期 UI，修罗场以单人近景交叉剪辑代替复杂群像',
    aiVideoRisks: '多位相似高颜值角色容易串脸；华丽服装、亲密互动和分支世界的一致性要求高',
  },
  {
    name: '真假千金·豪门复仇',
    description: '经典保留：真假身份错位叠加豪门利益争夺，女主在认亲、背叛与清算中夺回位置。',
    marketTier: 'classic',
    commonRelationships: ['真千金 vs 假千金', '女主 vs 偏心家人', '女主 vs 站队继承人'],
    commonHighlights: ['身份揭晓', '证据打脸', '断亲清算', '隐藏实力'],
    commonReversals: ['亲子鉴定被调包', '假千金也是真正继承人之一', '女主早已掌握家族命脉'],
    commonOpenings: ['认亲宴上被当众质疑', '被赶出家门后收到第二份鉴定', '真千金低调回国'],
    commonCliffhangers: ['新的血缘关系曝光', '遗嘱宣读出现陌生名字', '假千金拿出反向证据'],
    visualStyle: '现代豪门精致感，以宴会、家宅和职场空间表现身份阶层反差',
    shotPromptAdvice: '信物和鉴定书用后期可读特写；为两位千金设计显著不同的色彩与轮廓',
    aiVideoRisks: '相近年龄与妆造易导致角色混淆，宴会群像和纸面证据需要额外一致性处理',
  },
  {
    name: '青春校园·甜宠成长',
    description: '经典保留：校园、社团或初入职场背景下的双向成长，以轻喜甜宠承接青春议题。',
    marketTier: 'classic',
    commonRelationships: ['学霸 vs 偏科生', '青梅竹马 vs 新同学', '年轻人 vs 家庭期待'],
    commonHighlights: ['双向暗恋', '并肩成长', '公开维护', '误会解除'],
    commonReversals: ['匿名帮助者就是竞争对手', '看似退学实为追梦', '旧日误会来自善意隐瞒'],
    commonOpenings: ['开学第一天认错同桌', '社团招新被迫组队', '全校直播里意外告白'],
    commonCliffhangers: ['志愿选择让两人分道', '匿名账号身份即将曝光', '比赛前夕主力突然缺席'],
    visualStyle: '清透明亮青春感，教室、操场、天台和社团空间保持真实生活质感',
    shotPromptAdvice: '固定校服、座位与季节；用手部、眼神和并肩行走等可控动作表现暧昧',
    aiVideoRisks: '角色年龄感易漂移，群体校园场景容易出现重复面孔和服装不一致',
  },
  {
    name: '霸总虐恋·追妻火葬场',
    description: '经典保留：强势总裁因误会或利益伤害女主，在失去后付出代价追爱并完成关系重建。',
    marketTier: 'classic',
    commonRelationships: ['霸总 vs 清醒女主', '旧爱 vs 新选择', '情侣双方 vs 豪门家族'],
    commonHighlights: ['决绝离开', '追妻火葬场', '身份反转', '情感清算'],
    commonReversals: ['女主离开并非为了成全', '白月光才是操盘者', '霸总失去的还有继承权'],
    commonOpenings: ['离婚协议签下的瞬间真相曝光', '合约婚姻即将到期', '女主在订婚宴上公开离开'],
    commonCliffhangers: ['女主牵着新搭档出现', '当年证据被重新送达', '追妻条件要求男主放弃家业'],
    visualStyle: '精致都市情感风，冷暖色随关系变化，重点突出人物距离和权力位置变化',
    shotPromptAdvice: '亲密戏以眼神、空间距离和物件交接替代复杂肢体动作；情绪高潮多用稳定近景',
    aiVideoRisks: '微表情、口型和亲密动作容易失真，豪宅与办公室场景若缺少锚点会频繁变化',
  },
]

export const HOT_GENRE_PRESET_NAMES = BUILT_IN_GENRE_PRESETS
  .filter((preset) => preset.marketTier === 'hot')
  .map((preset) => preset.name)

export const CLASSIC_GENRE_PRESET_NAMES = BUILT_IN_GENRE_PRESETS
  .filter((preset) => preset.marketTier === 'classic')
  .map((preset) => preset.name)

/** 升级时只移除旧版本的内置项；同名用户自定义项由 repository 保留。 */
export const RETIRED_BUILT_IN_GENRE_PRESET_NAMES = [
  '女频复仇',
  '真假千金',
  '重生逆袭',
  '霸总追妻',
  '先婚后爱',
  '豪门恩怨',
  '赘婿打脸',
  '战神归来',
  '悬疑反转',
  '古装权谋',
  '玄学直播',
] as const
