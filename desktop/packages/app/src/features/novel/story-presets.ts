import type { StudioClient } from "@dramaip/client";
import type {
  Chapter,
  ChapterInput,
  DomainEntityInput,
  ProjectInput,
  ProjectModeConfig,
} from "@dramaip/contracts/product";
import {
  projectInputFromBrief,
  type ProductionBriefDraft,
} from "../../project-intake";

export type NovelStoryPresetId =
  "group-pet" | "doomsday-hoarding" | "beast-evolution" | "jiahao";

interface PresetCharacter {
  title: string;
  role: string;
  background: string;
  personality: string;
  goal: string;
  weakness: string;
  relationships: string;
  arc: string;
  visual: string;
}

interface PresetStoryArc {
  title: string;
  conflict: string;
  highlights: string;
}

interface PresetOpeningChapter {
  summary: string;
  outline: string;
  mainConflict: string;
  hook: string;
  highlight: string;
  reversal: string;
  cliffhanger: string;
}

export interface NovelStoryPreset {
  id: NovelStoryPresetId;
  label: string;
  tagline: string;
  summary: string;
  targetAudience: string;
  coreHook: string;
  emotionalCore: string;
  coreSellingPoint: string;
  synopsis: string;
  styleGuide: string;
  visualStyleDirection: string;
  genreOpportunity: string;
  characters: readonly PresetCharacter[];
  bookOutline: string;
  storyArcs: readonly PresetStoryArc[];
  openingChapter: PresetOpeningChapter;
}

export const NOVEL_STORY_PRESETS = [
  {
    id: "group-pet",
    label: "团宠",
    tagline: "靠能力赢得偏爱，而不是被动等待拯救",
    summary:
      "被忽视的主角进入一个表面冷漠、内部各有伤口的集体，以真实能力解决危机，逐步获得接纳与共同守护。",
    targetAudience: "偏好群像、治愈、成长与高情绪回报的女性向读者",
    coreHook:
      "一个人人看轻的局外人被迫进入最难接近的强者集体，却一次次成为解决危机的关键。",
    emotionalCore:
      "从不被选择到主动赢得归属，爱与守护必须建立在尊重和共同成长上。",
    coreSellingPoint:
      "冷面群像逐个破防、主角以能力换来信任、集体护短与身份真相形成连续情绪高潮。",
    synopsis:
      "主角长期被原有关系忽视，在一次意外中进入一个规则严苛的新集体。成员起初各有戒心，主角也拒绝用讨好换取位置。随着共同危机出现，主角凭被低估的能力补上集体最关键的缺口，并逐步看见每个人强硬外表下的伤口。外部势力利用主角的身世挑拨关系，迫使所有人决定这份归属究竟只是利益联盟，还是愿意共同承担代价的家。",
    styleGuide:
      "主角必须通过判断、行动和代价赢得爱，不写无理由溺爱。四名核心角色的表达方式、保护方式和成长方向应明显不同。每一阶段至少包含一次能力证明、一次关系误判和一次双向救赎；反派冲突服务于群像选择，不用重复羞辱堆砌爽点。",
    visualStyleDirection:
      "明亮治愈与危机冷色形成对比，强调群像站位、细微表情和从疏离到靠近的空间变化。",
    genreOpportunity:
      "团宠仍有稳定情绪需求，以能力型主角、差异化守护关系和真实群像成长避免低幼化与同质化。",
    characters: [
      {
        title: "主角槽位（待命名）",
        role: "被低估的能力型主角",
        background: "长期处于被忽视的位置，因一次意外进入新的强者集体。",
        personality: "敏锐、自尊、克制，不用讨好换取关系。",
        goal: "先获得独立生存的位置，再建立一段可以彼此托付的关系。",
        weakness: "害怕再次被抛弃，因此习惯隐藏需求并提前离开。",
        relationships:
          "与守护者从戒备到并肩；与理性盟友互补；与竞争者争夺的不是宠爱，而是价值定义权。",
        arc: "从证明自己值得留下，成长为能主动选择归属并保护集体的人。",
        visual: "外形与姓名由创作者决定；视觉变化体现从局外人到核心成员。",
      },
      {
        title: "守护者槽位（待命名）",
        role: "集体的冷面核心与规则维护者",
        background: "曾因错误信任付出代价，因此把情感藏在严格规则之后。",
        personality: "寡言、负责、判断迅速，保护欲通过行动表达。",
        goal: "维持集体安全，同时确认主角是否值得打破旧规则。",
        weakness: "把控制误当保护，不擅长承认自己的情感需要。",
        relationships: "最晚表达接纳，却在关键选择中承担最大代价。",
        arc: "从审查主角到学会尊重主角的选择，与其建立平等同盟。",
        visual: "克制、利落、具有秩序感；避免单一霸总化。",
      },
      {
        title: "理性盟友槽位（待命名）",
        role: "最早看见主角真实能力的观察者",
        background: "掌握集体运行的信息与技术，却长期被当作辅助角色。",
        personality: "理性、幽默、擅长拆解问题，也会隐藏自己的脆弱。",
        goal: "让集体用事实而非偏见做决定，并找到自己的不可替代性。",
        weakness: "习惯旁观，不愿为关系承担公开立场。",
        relationships: "与主角建立互补搭档关系，是群像冲突中的事实锚点。",
        arc: "从安全旁观者成长为愿意公开站队并承担后果的人。",
        visual: "细节体现聪明与松弛，和守护者形成视觉反差。",
      },
      {
        title: "竞争者槽位（待命名）",
        role: "质疑主角资格的内部竞争者",
        background: "曾靠巨大代价获得现在的位置，担心主角轻易夺走认可。",
        personality: "骄傲、直接、胜负欲强，但有清晰底线。",
        goal: "证明自己的价值并揭穿主角可能隐藏的风险。",
        weakness: "把稀缺的爱与资源理解为零和竞争。",
        relationships: "与主角经历对抗、误判、共同作战，最终形成相互承认。",
        arc: "从争宠式对抗转向守护共同目标，保留独立锋芒。",
        visual: "鲜明、具有攻击性，与主角形成互补而非复制。",
      },
    ],
    bookOutline:
      "开端：主角被原关系推开，意外进入规则严苛的新集体，并因一次小危机展示被低估的能力。\n发展：主角与四名核心成员在任务和日常中建立差异化关系，竞争者不断质疑其资格，外部威胁开始追索主角身世。\n升级：集体因是否相信主角发生分裂，主角主动离开并独自承担危机，所有成员必须作出公开选择。\n高潮：身世真相揭晓，主角拒绝被任何一方当作工具，以自己的方案联合群像解决终局危机。\n收束：主角获得的不是无条件娇宠，而是平等、可承担代价的归属；为后续系列保留新的共同任务。",
    storyArcs: [
      {
        title: "第一阶段·接纳测试",
        conflict: "主角需要在不讨好的前提下证明自己能为集体解决真实问题。",
        highlights:
          "首次能力证明；守护者破例；竞争者发现主角并非想象中的威胁。",
      },
      {
        title: "第二阶段·共同危机",
        conflict: "外部压力放大成员旧伤，主角与集体因信任边界发生分裂。",
        highlights: "群像分别站队；主角主动离开；理性盟友第一次公开承担立场。",
      },
      {
        title: "第三阶段·身份与守护",
        conflict: "主角身世成为各方争夺的筹码，集体必须决定是否共同承担代价。",
        highlights:
          "身份真相回收；竞争者反向护短；主角以独立选择完成真正归属。",
      },
    ],
    openingChapter: {
      summary:
        "主角在被原关系推开的当天进入新集体，并在无人看好的情况下解决一场迫在眉睫的小危机。",
      outline:
        "用一次具体的被忽视事件建立主角处境；让主角因现实需要进入新集体；成员以不同方式表达排斥；主角发现被所有人忽略的关键问题并提出方案。",
      mainConflict: "主角需要在不暴露全部底牌的情况下争取留下的资格。",
      hook: "所有人都认为主角会成为负担，只有主角看见危机真正的来源。",
      highlight: "主角用可验证的能力解决第一道难题，改变一名成员的判断。",
      reversal: "看似偶然的能力与主角被掩盖的身世存在关联。",
      cliffhanger: "守护者拿出一份旧记录，发现主角本不该出现在这里。",
    },
  },
  {
    id: "doomsday-hoarding",
    label: "末世囤货",
    tagline: "倒计时准备、有限资源与基地治理",
    summary:
      "主角提前获得灾变预警，在有限时间和受约束能力下完成准备；真正的难题不是囤得最多，而是灾后如何选择规则与同伴。",
    targetAudience: "偏好末世生存、经营建设、资源博弈与团队成长的读者",
    coreHook:
      "主角知道灾变即将到来，却只有有限资金、有限时间和存在边界的储物能力。",
    emotionalCore: "安全感不能只靠占有资源，而来自判断、秩序、互信和共同承担。",
    coreSellingPoint:
      "灾前倒计时的准备爽感、灾后基地经营、资源伦理选择与阶段性地图升级。",
    synopsis:
      "主角在一次异常事件后确认灾变倒计时，获得可以储存物资却有明确容量与使用代价的能力。主角必须在不惊动危险势力的情况下处理资产、验证预警并寻找可靠伙伴。灾变到来后，囤货优势迅速转化为治理难题：谁能加入、资源如何分配、规则怎样执行。随着环境升级和外部势力逼近，主角发现灾变并非单纯天灾，而储物能力也与更大的生态变化有关。",
    styleGuide:
      "所有物资、能力和决策都必须有成本与边界，避免无限空间直接消解冲突。准备过程强调选择和信息差，不写成购物清单。灾后每一轮危机同时推进生存、基地规则和人物关系；冲突可以解气，但不能以无差别残酷替代判断。",
    visualStyleDirection:
      "灾前日常暖色与倒计时异常细节并置，灾后强调天气、物资层级、基地空间和团队协作的可视化变化。",
    genreOpportunity:
      "末世题材适合长篇和AI视觉改编，以有限能力、真实经营和社区规则替代单纯囤货炫耀，可形成稳定系列。",
    characters: [
      {
        title: "预警者槽位（待命名）",
        role: "掌握灾变信息的生存型主角",
        background: "经历过一次失败或获得可信预警，拥有受限储物能力。",
        personality: "谨慎、执行力强、善于计算风险，但不轻易信任。",
        goal: "完成灾前准备并建立能够长期运转的安全据点。",
        weakness: "把安全等同于控制一切，容易忽视伙伴的自主性。",
        relationships:
          "依赖后勤伙伴落地计划，与技术成员互补，与道德对手争夺规则定义权。",
        arc: "从独自囤积的幸存者成长为能够授权、治理和共同承担的领导者。",
        visual: "由创作者定义；外观变化体现准备期、灾后期和领导期。",
      },
      {
        title: "后勤伙伴槽位（待命名）",
        role: "把宏大计划变成可执行清单的人",
        background: "熟悉采购、运输、财务或社区运行，最初不完全相信预警。",
        personality: "务实、耐心、善于谈判，对数字与细节敏感。",
        goal: "确保资源不是堆在那里，而能被安全地周转和使用。",
        weakness: "过度追求稳妥，在必须冒险时容易迟疑。",
        relationships: "与主角形成信任最深也争论最多的搭档关系。",
        arc: "从执行者成长为能独立决定基地命运的共同管理者。",
        visual: "日常感与专业细节并重，避免工具人化。",
      },
      {
        title: "技术成员槽位（待命名）",
        role: "解决能源、防御、医疗或生态问题的专家",
        background: "拥有关键专业能力，却因过去的失败不愿承担领导责任。",
        personality: "专注、直接、对技术诚实，对人情判断迟钝。",
        goal: "建立可持续系统，并查明灾变异常的技术来源。",
        weakness: "容易把人当变量，忽略选择背后的情感代价。",
        relationships: "与后勤伙伴互相制衡，是能力真相线的主要推动者。",
        arc: "从只对方案负责，成长为也对使用方案的人负责。",
        visual: "突出工具、工作痕迹与环境适应，不使用空泛白大褂符号。",
      },
      {
        title: "规则对手槽位（待命名）",
        role: "提出另一套生存秩序的竞争者",
        background: "拥有组织力或资源，坚信危机中必须牺牲少数换取效率。",
        personality: "强势、理性、富有号召力，不把自己视为反派。",
        goal: "控制区域资源并证明高压秩序才是唯一解。",
        weakness: "无法理解信任和自发协作产生的长期价值。",
        relationships: "既是主角的外部威胁，也是映照主角控制欲的镜像。",
        arc: "迫使主角明确自己的治理底线，并为后续更大阵营冲突保留空间。",
        visual: "秩序感强，与主角基地的人情温度形成反差。",
      },
    ],
    bookOutline:
      "开端：主角验证灾变预警和能力边界，在倒计时中处理资金、场地、物资与可信伙伴。\n发展：灾变准时发生，主角的准备解决第一轮危机，但幸存者加入让囤货优势迅速变成分配与治理难题。\n升级：环境灾害发生变化，技术系统出现缺口，规则对手以更高效率吸引成员，基地内部产生路线分裂。\n高潮：主角查明能力与灾变生态的联系，必须牺牲部分库存完成一次全体协作的迁移或防守。\n收束：基地建立透明且可迭代的规则，主角从资源拥有者转为共同体成员，并发现下一片区域的异常信号。",
    storyArcs: [
      {
        title: "第一阶段·灾前倒计时",
        conflict: "有限资金、时间和容量迫使主角判断什么真正值得准备。",
        highlights: "验证预警；第一次能力边界反噬；关键伙伴决定相信主角。",
      },
      {
        title: "第二阶段·灾变与建城",
        conflict: "据点资源有限，新成员不断增加，分配规则决定团队能否存活。",
        highlights:
          "首轮极端天气；能源或医疗系统故障；公开规则第一次接受挑战。",
      },
      {
        title: "第三阶段·稀缺与阵营",
        conflict: "规则对手争夺资源与成员，灾变真相迫使主角放弃单纯守成。",
        highlights: "基地路线分裂；牺牲库存换取集体生机；能力来源伏笔回收。",
      },
    ],
    openingChapter: {
      summary:
        "主角确认灾变倒计时并测试储物能力，在第一笔关键物资采购中遭遇信息泄露风险。",
      outline:
        "以一处不合常理的环境征兆开场；主角通过可验证细节确认预警；测试储物能力的容量与代价；制定第一版准备清单；在采购关键物资时发现有人也在提前行动。",
      mainConflict: "主角必须在不暴露预警和能力的情况下完成第一轮准备。",
      hook: "灾变尚未发生，只有主角知道平静生活已经进入倒计时。",
      highlight: "主角舍弃看似最爽的物资，选择真正决定存活率的关键资源。",
      reversal: "一项本应无人关注的物资已经被神秘买家提前清空。",
      cliffhanger: "监控里出现另一个准确避开摄像头、执行同类准备的人。",
    },
  },
  {
    id: "beast-evolution",
    label: "异兽升级",
    tagline: "最弱契约、分支进化与生态谜团",
    summary:
      "弱势主角与被判定为低价值的异兽建立契约，以战术协作和分支进化突破评价体系，并逐步揭开异兽生态真相。",
    targetAudience: "偏好玄幻升级、伙伴羁绊、战术对决与异兽视觉奇观的读者",
    coreHook:
      "全世界都认定主角契约的是无成长价值的异兽，只有主角看见它拥有未知的进化分支。",
    emotionalCore: "真正的成长不是把伙伴当装备，而是在彼此选择中打破既定评价。",
    coreSellingPoint:
      "异兽分支进化、搭档战术配合、学院与区域试炼、生态谜团和可持续地图升级。",
    synopsis:
      "在以异兽评级决定资源与身份的世界，主角因条件不足只能契约一只被判定为低价值的异兽。第一次实战中，主角发现它能通过非常规条件开启分支进化，却每次进化都伴随选择与代价。二者从互不信任到形成独特战术，在学院试炼和区域危机中不断打破评级体系。随着异兽表现超出常识，研究机构与强大势力开始追查，主角也发现所谓低等异兽可能保存着被人为抹去的生态真相。",
    styleGuide:
      "每次升级必须源于训练、环境、材料和关系选择，不能无成本跳级。异兽拥有独立性格、恐惧和目标，不是会说话的技能栏。战斗强调信息、地形与配合，每个新形态同时带来优势和新的限制；持续回收生态谜团，避免只换地图刷怪。",
    visualStyleDirection:
      "建立清晰可复用的异兽轮廓、纹理、能力色彩和进化阶段；战斗突出体型差、地形利用与双向配合。",
    genreOpportunity:
      "异兽与升级流适合AI漫剧和系列开发，以稳定角色设计、明确进化树和生态悬念形成长线追更动力。",
    characters: [
      {
        title: "契约者槽位（待命名）",
        role: "被评级体系忽视的战术型主角",
        background: "资源和先天条件不足，却拥有出色观察力或特殊感知。",
        personality: "耐心、好奇、善于复盘，不轻易接受权威结论。",
        goal: "和异兽共同获得独立选择未来的资格，并查明异常进化的来源。",
        weakness: "过度依赖分析，害怕自己的判断让伙伴再次受伤。",
        relationships:
          "与异兽建立双向契约；与精英对手竞争；向研究导师学习又质疑其立场。",
        arc: "从证明评级错误，成长为能提出新规则并承担生态后果的人。",
        visual: "装备和外形由创作者决定，突出观察、准备和与异兽配合的痕迹。",
      },
      {
        title: "异兽伙伴槽位（待命名）",
        role: "拥有未知进化分支的低评级异兽",
        background: "族群或来历存在缺失记录，被现有体系误判为没有培养价值。",
        personality: "具有清晰偏好、恐惧和学习方式，与主角并非天然亲近。",
        goal: "摆脱被占有和实验的命运，找到自己的族群或生态位置。",
        weakness: "每次进化都会失去一种旧能力或增加新的生理负担。",
        relationships:
          "与主角从利益契约走向伙伴关系，对导师与研究机构保持本能戒备。",
        arc: "从被评估的对象成长为主动选择进化路线和战斗意义的主体。",
        visual: "必须定义基础形态与进化阶段的稳定识别元素，避免每次完全换脸。",
      },
      {
        title: "精英对手槽位（待命名）",
        role: "相信成熟评级体系的顶尖契约者",
        background: "从小获得最好资源，也承受必须保持第一的巨大压力。",
        personality: "自律、骄傲、尊重实力，初期把主角视为偶然。",
        goal: "证明标准化培养才是保护契约者与异兽的最优路径。",
        weakness: "害怕承认体系错误会否定自己过去全部努力。",
        relationships: "与主角多次战术交锋，最终在更大生态危机中形成有限同盟。",
        arc: "从维护等级秩序，成长为愿意修正规则但保留竞争立场的人。",
        visual: "整齐、标准化、资源充足，与主角的实战改造形成反差。",
      },
      {
        title: "研究导师槽位（待命名）",
        role: "掌握部分生态真相的研究者",
        background: "曾参与建立评级体系，因一次事故开始怀疑被掩盖的数据。",
        personality: "严谨、复杂、愿意教导但不会交出全部真相。",
        goal: "确认异常进化是否会引发生态灾难，并弥补过去的选择。",
        weakness: "把保密视为保护，因此反复伤害学生的信任。",
        relationships: "既是主角的知识来源，也是中期最大的信任障碍。",
        arc: "从控制信息转向公开承担责任，交出决定生态未来的证据。",
        visual: "体现长期野外研究和旧事故痕迹，而非抽象神秘导师。",
      },
    ],
    bookOutline:
      "开端：主角在契约测试中只能选择低评级异兽，双方勉强合作并在第一次危机中触发未知进化征兆。\n发展：主角通过训练、材料和战术验证分支进化，在学院与区域试炼中连续打破评级预期，引起精英对手和研究导师关注。\n升级：研究机构试图控制异兽，主角发现进化记录被人为删除；异兽也因代价和被利用的恐惧与主角决裂。\n高潮：区域生态失衡爆发，主角、异兽和对手必须用不同进化路线组成战术同盟，并公开评级体系隐藏的真相。\n收束：异兽自主选择下一条进化分支，主角获得探索更大区域的资格，新的生态异常成为系列入口。",
    storyArcs: [
      {
        title: "第一阶段·契约与首进化",
        conflict: "主角和异兽互不信任，必须在资源不足时完成第一次真正协作。",
        highlights: "低评级契约；越级战术取胜；出现不在图鉴中的进化特征。",
      },
      {
        title: "第二阶段·团队试炼",
        conflict: "连续胜利引来审查，主角需要证明进化不是危险作弊。",
        highlights: "多地形试炼；与精英对手互换优势；导师暴露部分旧事故。",
      },
      {
        title: "第三阶段·生态真相",
        conflict: "研究势力争夺异兽，生态失衡迫使所有人重新定义进化。",
        highlights: "伙伴决裂与重选；进化代价回收；评级真相公开。",
      },
    ],
    openingChapter: {
      summary:
        "主角在契约测试中被迫选择最低评级异兽，第一次协作便发现它拥有图鉴无法解释的反应。",
      outline:
        "展示评级体系如何决定资源；主角在测试中遭遇失败或不公；低评级异兽拒绝配合；突发危险迫使双方临时协作；战斗后出现短暂的未知进化纹路。",
      mainConflict:
        "主角必须在被淘汰前与拒绝信任人类的异兽完成第一次契约协作。",
      hook: "最弱的两名失败者被放在一起，却同时看见现有评级忽略的漏洞。",
      highlight: "主角不用等级压制，而以地形和观察完成第一次越级解围。",
      reversal: "异兽并非不能进化，而是在主动拒绝某条被强加的进化路线。",
      cliffhanger: "检测仪闪过一个早已从官方图鉴删除的古老编号。",
    },
  },
  {
    id: "jiahao",
    label: "嘉豪",
    tagline: "绑定嘉豪系统，在爆笑任务中一路登顶",
    summary:
      "处于人生低谷的普通主角意外绑定嘉豪系统，在一连串离谱却有效的任务中获得能力、伙伴与机会，以轻松搞笑的方式持续升级，最终走向属于自己的巅峰。",
    targetAudience: "偏好系统流、轻松搞笑、反套路升级与持续爽点的年轻读者",
    coreHook:
      "最倒霉的普通人绑定嘉豪系统，系统发布的任务看似离谱，完成后却总能解决真问题并解锁意想不到的成长奖励。",
    emotionalCore:
      "让笑点陪伴逆袭，让主角在一次次敢做、做成和承担后，把偶然奖励变成真正属于自己的巅峰实力。",
    coreSellingPoint:
      "系统与宿主斗嘴、反套路任务、误会式打脸、可视化奖励升级，以及主角用最搞笑的过程完成最硬核的逆袭。",
    synopsis:
      "主角在事业、修炼或生活跌入低谷时，意外绑定来历不明的嘉豪系统。系统以任务推动成长，但任务说明总带着离谱条件：主角必须在看似不可能、不合时宜或容易引发误会的情况下完成真正有价值的目标。每次任务都遵循“搞笑开局、意外破局、真实收获”的节奏，奖励只提供新能力、资源或线索，能否变强仍取决于主角的判断和行动。随着任务等级提升，主角从解决身边小麻烦走向更大舞台，在伙伴吐槽和强敌错愕中建立自己的成长路线，并逐渐发现嘉豪系统正在寻找一位能用乐观与行动打破旧规则的巅峰宿主。",
    styleGuide:
      "坚持轻松搞笑的系统升级流：每个阶段至少包含一个离谱任务、一次误会升级、一次可验证的能力成长和一次反套路破局。笑点来自系统规则、宿主吐槽、任务执行方式与旁观反应，不针对姓名、长相、地域、阶层或未成年人身份。系统奖励必须有边界，只提供成长条件，不能替主角自动取胜；失败、跳过或滥用能力都要有明确代价。任务不能要求羞辱、伤害无辜者或突破基本伦理。不得复刻现实人物、账号、原视频、受保护音乐或可识别经历。结局不固定，但主角必须在搞笑历程中凭真实积累走向所在领域的巅峰。",
    visualStyleDirection:
      "以明快现实或类型世界为底色，用简洁系统面板、任务弹窗、奖励动画和夸张反应强化喜剧节奏；关键升级与巅峰场面逐步扩大尺度，但保留宿主与系统斗嘴的轻松感。",
    genreOpportunity:
      "轻松系统流适合长篇连载、短剧和AI漫剧，以单元任务提供稳定笑点，以奖励树和舞台升级维持追更爽感，并可适配都市、校园、职场、玄幻等用户灵感。",
    characters: [
      {
        title: "系统宿主槽位（待命名）",
        role: "绑定嘉豪系统的成长型主角",
        background: "在创作者选择的世界与领域中处于低谷，意外成为系统宿主。",
        personality: "乐观、机灵、脸皮够厚，擅长在尴尬和危机中临场变通。",
        goal: "借助系统提供的机会改变命运，最终凭自己的能力走向巅峰。",
        weakness: "初期容易依赖奖励，也常因好胜接下超出能力范围的任务。",
        relationships:
          "与嘉豪系统从互相吐槽到默契搭档；与清醒伙伴共同破局；用反套路方式迫使巅峰对手认真看待自己。",
        arc: "从靠奖励翻身的新手，成长为能反过来定义任务、独立承担巅峰挑战的人。",
        visual:
          "姓名、外形和成长领域由创作者决定，以装备、状态或气质变化体现阶段升级。",
      },
      {
        title: "嘉豪系统槽位（待命名形态）",
        role: "发布反套路任务并结算成长奖励的系统伙伴",
        background:
          "来历和终极目的未知，只确认它会寻找能在困境中保持行动力的宿主。",
        personality: "一本正经地发布离谱任务，嘴硬、毒舌，偶尔出现人性化卡顿。",
        goal: "推动宿主完成巅峰路线，同时验证自身被隐藏的系统使命。",
        weakness:
          "受规则和能量限制，不能直接解决现实问题，也可能误判人类情绪。",
        relationships: "既是主角的金手指，也是最稳定的吐槽搭档和成长监督者。",
        arc: "从冷冰冰的任务界面逐步形成独立判断，并在终局把选择权交还宿主。",
        visual: "可设计为声音、面板、吉祥物或其他原创形态，不固定具体外观。",
      },
      {
        title: "吐槽搭档槽位（待命名）",
        role: "负责见证、拆台并协助主角完成任务的清醒伙伴",
        background: "原本只想过正常生活，却多次被卷入主角看似荒唐的任务现场。",
        personality: "理性、嘴快、观察敏锐，吐槽归吐槽，关键时刻执行力极强。",
        goal: "弄清主角为何总能歪打正着，并借此完成自己的成长目标。",
        weakness: "过度相信常识，前期容易错过非常规方案的真实价值。",
        relationships:
          "不知道或逐步察觉系统存在，与主角形成一唱一和的黄金搭档。",
        arc: "从被迫收拾残局，成长为能主动设计反套路破局方案的核心伙伴。",
        visual: "与主角形成节奏和气质反差，突出丰富、克制的喜剧反应。",
      },
      {
        title: "巅峰对手槽位（待命名）",
        role: "当前领域公认的天才、强者或规则受益者",
        background: "靠正统路线站在主角前方，最初无法理解主角的搞笑成长方式。",
        personality: "认真、自律、胜负欲强，越想维持严肃越容易被主角打乱节奏。",
        goal: "守住自己的领先位置，并证明稳定实力胜过系统制造的偶然。",
        weakness: "路径依赖严重，面对反套路局面时不够灵活。",
        relationships:
          "从看轻主角到认真竞争，既贡献反差笑点，也持续抬高巅峰标准。",
        arc: "迫使主角摆脱奖励依赖；自身也在竞争中突破旧规则，可成为终局对手或盟友。",
        visual: "保持强者可信度，以严肃气场和主角的轻松破局形成鲜明反差。",
      },
    ],
    bookOutline:
      "开端：主角在人生低谷遭遇一场公开失败，意外绑定嘉豪系统；第一项新手任务荒唐得像恶作剧，却在执行中解决真实危机并兑现首份奖励。\n发展：系统任务从日常小目标升级到领域试炼，主角与吐槽搭档形成固定喜剧组合；每次误会和出糗都转化为可验证的能力、资源或人脉积累。\n升级：主角名声与实力同步上涨，巅峰对手开始认真设局；系统任务出现更高代价，主角发现只靠奖励无法通过真正考验。\n高潮：系统发布终极巅峰任务，却因规则限制无法提供关键奖励；主角必须整合一路积累的能力、伙伴和经验，用最出人意料也最可靠的方案完成登顶。\n收束：主角走向创作者设定领域的巅峰，并获得重新定义嘉豪系统任务规则的资格；保留更高舞台、系统来历和新任务线，不锁定固定结局。",
    storyArcs: [
      {
        title: "第一阶段·系统绑定与爆笑新手任务",
        conflict:
          "主角必须判断嘉豪系统究竟是机会还是恶作剧，并在不突破底线的情况下完成离谱任务。",
        highlights:
          "低谷绑定；宿主与系统首次斗嘴；任务引发误会却歪打正着；首份真实奖励到账。",
      },
      {
        title: "第二阶段·任务升级与欢乐逆袭",
        conflict:
          "任务难度、公开程度和失败代价同步增加，主角必须把系统奖励转化为稳定实力。",
        highlights:
          "固定搭档成形；连续反套路打脸；解锁能力树；巅峰对手第一次被搞笑打法正面击败。",
      },
      {
        title: "第三阶段·系统真相与巅峰登顶",
        conflict:
          "系统无法再替主角提供关键条件，终极任务只能依靠此前的真实积累完成。",
        highlights:
          "系统使命揭晓；奖励暂时失效；伙伴共同回归；主角以爆笑开局和硬核结果完成登顶。",
      },
    ],
    openingChapter: {
      summary:
        "主角在人生最倒霉的一天绑定嘉豪系统，被迫接受一项看似离谱的新手任务，却意外解决了眼前真正的危机。",
      outline:
        "用一连串小倒霉建立主角低谷；在最糟时刻弹出嘉豪系统绑定提示；系统发布带有限时、离谱条件和明确奖励的新手任务；主角边吐槽边尝试执行，引发围观与误会；任务结果真正解决危机并完成第一次结算。",
      mainConflict:
        "主角必须在任务倒计时结束前，用不伤害任何人的方式完成看似荒唐的新手挑战。",
      hook: "当主角以为今天已经不可能更倒霉时，耳边响起一句：嘉豪系统绑定成功。",
      highlight:
        "主角把离谱任务临场改造成有效方案，在所有人笑出声时完成第一次漂亮逆袭。",
      reversal: "看似随机的搞笑任务其实精确命中了危机中最容易被忽略的突破口。",
      cliffhanger: "系统判定宿主完成方式超出预期，隐藏的巅峰路线第一次亮起。",
    },
  },
] as const satisfies readonly NovelStoryPreset[];

export function novelStoryPreset(
  id: NovelStoryPresetId | undefined,
): NovelStoryPreset | undefined {
  return NOVEL_STORY_PRESETS.find((preset) => preset.id === id);
}

export function novelStoryPresetForLabel(
  label: string | undefined,
): NovelStoryPreset | undefined {
  return NOVEL_STORY_PRESETS.find((preset) => preset.label === label);
}

export function applyNovelStoryPresetToBrief(
  draft: ProductionBriefDraft,
  preset: NovelStoryPreset,
): ProductionBriefDraft {
  return {
    ...draft,
    shortDramaType: preset.label,
    targetAudience: preset.targetAudience,
    visualStyleDirection: preset.visualStyleDirection,
  };
}

export function projectInputFromStoryPreset(
  draft: ProductionBriefDraft,
  preset: NovelStoryPreset,
  modeConfig?: ProjectModeConfig,
): ProjectInput {
  const input = projectInputFromBrief(draft, modeConfig);
  const idea = draft.idea.trim();
  return {
    ...input,
    shortDramaType: preset.label,
    targetAudience: draft.targetAudience.trim() || preset.targetAudience,
    coreHook: preset.coreHook,
    emotionalCore: preset.emotionalCore,
    coreSellingPoint: preset.coreSellingPoint,
    synopsis: idea
      ? `【用户灵感】\n${idea}\n\n【预设展开方向】\n${preset.synopsis}`
      : preset.synopsis,
    styleGuide: [
      `【完整故事预设】${preset.label}`,
      idea ? `【用户灵感优先】\n${idea}` : "【用户灵感】待补充",
      `【创作规则】\n${preset.styleGuide}`,
    ].join("\n\n"),
    visualStyleDirection:
      draft.visualStyleDirection.trim() || preset.visualStyleDirection,
    genreOpportunity: preset.genreOpportunity,
    productionBrief: [
      input.productionBrief,
      `故事预设：${preset.label}`,
      modeConfig?.mode === "single_season"
        ? "初始化内容：单季故事母稿、4 个角色槽位、第一季季纲和第 1 集结构节点"
        : "初始化内容：4 个角色槽位、1 份全书大纲、3 个阶段故事弧、第 1 章结构节点",
    ]
      .filter(Boolean)
      .join("\n"),
  };
}

const SINGLE_SEASON_CHARACTER_SLOTS = [
  ["主角槽位（待命名）", "推动单季故事主线的核心人物"],
  ["核心关系人物（待命名）", "与主角形成主要情感或利益关系"],
  ["对立角色（待命名）", "制造核心阻力并迫使主角选择"],
  ["关键配角（待命名）", "承担信息、转折或情绪支点"],
] as const;

export async function initializeSingleSeasonMaterials(
  client: StudioClient,
  projectId: string,
  input: {
    idea: string;
    targetEpisodeCount: number;
    preset?: NovelStoryPreset;
  },
): Promise<Chapter> {
  const idea = input.idea.trim();
  const preset = input.preset;
  const storyOutline = preset
    ? [
        preset.bookOutline,
        ...preset.storyArcs.map(
          (arc) =>
            `${arc.title}\n核心冲突：${arc.conflict}\n高光：${arc.highlights}`,
        ),
      ].join("\n\n")
    : idea;
  const chapter = await client.chapters.create({
    projectId,
    title: "单季故事母稿",
    summary: preset?.summary ?? idea,
    outline: storyOutline || "待完善单季故事结构",
    content: "",
    mainConflict: preset?.openingChapter.mainConflict,
    hook: preset?.openingChapter.hook,
    highlight: preset?.openingChapter.highlight,
    reversal: preset?.openingChapter.reversal,
    cliffhanger: preset?.openingChapter.cliffhanger,
  });
  const characterInputs = preset
    ? resourceInputsFromStoryPreset(projectId, preset, idea).filter(
        (resource) => resource.domain === "characters",
      )
    : SINGLE_SEASON_CHARACTER_SLOTS.map(([title, role]) => ({
        domain: "characters" as const,
        input: {
          projectId,
          title,
          payload: {
            角色定位: role,
            身份背景: "待完善",
            欲望与目标: "待完善",
            人物关系: "待完善",
            视觉描述: "待完善",
          },
        },
      }));
  for (const resource of characterInputs)
    await client.resources.create(resource.domain, resource.input);
  const adaptation = await client.resources.create("adaptations", {
    projectId,
    title: "第一季季纲",
    payload: {
      改编方向: preset?.label ?? "原创单季短剧",
      目标集数: input.targetEpisodeCount,
      季纲: storyOutline || "待完善",
      三阶段结构: preset
        ? preset.storyArcs.map((arc) => ({
            阶段: arc.title,
            核心冲突: arc.conflict,
            高光与回收: arc.highlights,
          }))
        : ["开局与关系建立", "冲突升级与关键选择", "高潮与收束"],
    },
  });
  await client.resources.create("episodes", {
    projectId,
    parentId: adaptation.id,
    title: "第 1 集",
    payload: {
      集数: 1,
      分集简介: preset?.openingChapter.summary ?? (idea || "待完善"),
      核心冲突: preset?.openingChapter.mainConflict ?? "待完善",
      开场钩子: preset?.openingChapter.hook ?? "待完善",
      结尾悬念: preset?.openingChapter.cliffhanger ?? "待完善",
    },
  });
  await client.productionStructure.selectCurrentAdaptation(projectId, {
    adaptationId: adaptation.id,
  });
  return chapter;
}

export function chapterInputFromStoryPreset(
  projectId: string,
  preset: NovelStoryPreset,
): ChapterInput {
  return {
    projectId,
    title: "第 1 章",
    summary: preset.openingChapter.summary,
    outline: preset.openingChapter.outline,
    content: "",
    mainConflict: preset.openingChapter.mainConflict,
    hook: preset.openingChapter.hook,
    highlight: preset.openingChapter.highlight,
    reversal: preset.openingChapter.reversal,
    cliffhanger: preset.openingChapter.cliffhanger,
  };
}

export function resourceInputsFromStoryPreset(
  projectId: string,
  preset: NovelStoryPreset,
  idea: string,
): ReadonlyArray<{
  domain: "characters" | "outlines" | "story-arcs";
  input: DomainEntityInput;
}> {
  const userIdea = idea.trim();
  return [
    ...preset.characters.map((character) => ({
      domain: "characters" as const,
      input: {
        projectId,
        title: character.title,
        payload: {
          角色定位: character.role,
          身份背景: character.background,
          性格: character.personality,
          欲望与目标: character.goal,
          秘密与弱点: character.weakness,
          人物关系: character.relationships,
          人物弧光: character.arc,
          视觉描述: character.visual,
        },
      },
    })),
    {
      domain: "outlines" as const,
      input: {
        projectId,
        title: `${preset.label}·全书骨架`,
        payload: {
          大纲层级: "全书",
          排序: 0,
          内容: userIdea
            ? `【用户灵感】\n${userIdea}\n\n【预设骨架】\n${preset.bookOutline}`
            : preset.bookOutline,
        },
      },
    },
    ...preset.storyArcs.map((arc) => ({
      domain: "story-arcs" as const,
      input: {
        projectId,
        title: arc.title,
        payload: {
          层级: "阶段",
          核心冲突: arc.conflict,
          高光与伏笔回收: arc.highlights,
        },
      },
    })),
  ];
}

export async function initializeStoryPresetMaterials(
  client: StudioClient,
  projectId: string,
  preset: NovelStoryPreset,
  idea: string,
): Promise<Chapter> {
  const resourceInputs = resourceInputsFromStoryPreset(projectId, preset, idea);
  const results = await Promise.allSettled([
    client.chapters.create(chapterInputFromStoryPreset(projectId, preset)),
    ...resourceInputs.map(({ domain, input }) =>
      client.resources.create(domain, input),
    ),
  ]);
  const failure = results.find(
    (result): result is PromiseRejectedResult => result.status === "rejected",
  );
  if (failure) throw failure.reason;
  return (results[0] as PromiseFulfilledResult<Chapter>).value;
}

export function storyPresetRefinementInstruction(
  preset: NovelStoryPreset,
  area: "project" | "characters" | "outline" | "arc",
): string {
  const target = {
    project: "项目钩子、梗概、情绪主轴与创作规范",
    characters: "现有四个角色槽位及其关系和人物弧光",
    outline: "现有全书大纲、阶段升级与关键回收",
    arc: "现有三个故事弧的冲突、高光、伏笔和衔接",
  }[area];
  return `保留用户灵感和“${preset.label}”预设已经建立的内容，不删除已确认资料；请只补充和差异化${target}，避免套用固定姓名、固定结局或照搬热门作品。`;
}
