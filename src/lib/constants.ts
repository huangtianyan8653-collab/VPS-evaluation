export type Dimension = 'philosophy' | 'mechanism' | 'team' | 'tools';
export const DIMENSIONS: Dimension[] = ['philosophy', 'mechanism', 'team', 'tools'];

export const MOCK_HOSPITALS = [
    { id: 'H001', name: '北京协和医院', level: '三级甲等', region: '北京' },
    { id: 'H002', name: '四川大学华西医院', level: '三级甲等', region: '四川' },
    { id: 'H003', name: '上海交通大学医学院附属瑞金医院', level: '三级甲等', region: '上海' },
    { id: 'H004', name: '复旦大学附属中山医院', level: '三级甲等', region: '上海' },
    { id: 'H005', name: '中山大学附属第一医院', level: '三级甲等', region: '广东' },
];

export interface Question {
    id: string;
    dimension: Dimension;
    text: string;
    description: string;
    failureAction: string;
    weight?: number;
}

export const QUESTIONS: Question[] = [
    // 理念 (Philosophy)
    {
        id: 'p1',
        dimension: 'philosophy',
        text: '医院管理层是否高度重视并主动推进带量采购相关政策落地？',
        description: '关注医院一把手及核心管理层对政策及学术价值的认可度。',
        failureAction: '需加强与院级领导的政策沟通，传递国家集采政策导向及产品的学术价值。',
        weight: 1,
    },
    {
        id: 'p2',
        dimension: 'philosophy',
        text: '骨干医生是否认可本产品的临床疗效与安全性？',
        description: '指核心科室主任和高年资医生对药物在抗感染领域的评价。',
        failureAction: '需开展科室学术交流会，展示真实世界数据与临床案例，提升学术认可。',
        weight: 1,
    },
    // 机制 (Mechanism)
    {
        id: 'm1',
        dimension: 'mechanism',
        text: '医院是否已建立明确的抗感染药物准入及遴选流程？',
        description: '考察药事委员会对新药或集采药品的常态化引入规则。',
        failureAction: '跟进药事会动态，协助药剂科完善相关的药物经济学评价资料。',
        weight: 1,
    },
    {
        id: 'm2',
        dimension: 'mechanism',
        text: '本产品是否已被纳入常规处方集管理？',
        description: '产品是否已能被医生正常、无阻碍地开出处方。',
        failureAction: '梳理并消除院内处方开具的审批屏障或限制性要求。',
        weight: 1,
    },
    // 团队 (Team)
    {
        id: 't1',
        dimension: 'team',
        text: '核心临床科室（如ICU、呼吸科）与药剂科之间沟通是否顺畅？',
        description: '用药需求能否及时通过药剂科采购得到响应。',
        failureAction: '建立多学科或临床与药学部门的沟通桥梁，促进用药需求对齐。',
        weight: 1,
    },
    {
        id: 't2',
        dimension: 'team',
        text: '医院内部是否有专职团队负责集采政策落地跟进？',
        description: '考察医院行政执行层面的专职力量。',
        failureAction: '主动协助医院医保/采购办，提供准入及落地的专业数据支持。',
        weight: 1,
    },
    // 工具 (Tools)
    {
        id: 'tool1',
        dimension: 'tools',
        text: '医院HIS系统是否已嵌入智能化的集采处方管控模块？',
        description: '通过信息化手段管理处方的比例与合规性。',
        failureAction: '了解医院HIS系统供应商及升级计划，探索系统的合规用药提醒功能。',
        weight: 1,
    },
    {
        id: 'tool2',
        dimension: 'tools',
        text: '医院是否推行抗感染药物的标准化临床路径（信息化辅助）？',
        description: '医生在开具抗感染药物时，是否有系统层面的临床路径指引。',
        failureAction: '推动相关疾病领域的临床路径共识宣贯，纳入系统标准化管理。',
        weight: 1,
    }
];

// 每个维度的判定阈值 (假设每题1分，Threshold为2则需要全对才是H，如果配置1，则对1题就是H)
export const THRESHOLDS: Record<Dimension, number> = {
    philosophy: 1,
    mechanism: 1,
    team: 1,
    tools: 1,
};

// 16种分型映射 (理念, 机制, 团队, 工具)
export const STRATEGIES: Record<string, { type: string; strategy: string }> = {
    'H,H,H,H': { type: '战略标杆型', strategy: '全面深化战略合作，打造区域示范基地，探索创新模式。' },
    'H,H,H,L': { type: '潜力成长型', strategy: '协助系统升级与数字化转型，补齐工具短板。' },
    'H,H,L,H': { type: '机制驱动型', strategy: '强化团队建设与科室联动，打破内部协同壁垒。' },
    'H,L,H,H': { type: '团队主导型', strategy: '推动处方常态化与准入机制完善，固化业务流程。' },
    'L,H,H,H': { type: '客观条件优越型', strategy: '重塑管理层理念，加强学术传递与政策宣导。' },
    'H,H,L,L': { type: '理念机制双优型', strategy: '优先建立工作小组，逐步引入信息化管理工具。' },
    'H,L,H,L': { type: '理念团队双优型', strategy: '打通准入机制，随后推动信息化管理升级。' },
    'H,L,L,H': { type: '理念工具辅助型', strategy: '以业务骨干为抓手，优化机制并建立协作团队。' },
    'L,H,H,L': { type: '机制团队双驱动', strategy: '引入创新管理理念，补齐前瞻性认知与工具落地。' },
    'L,H,L,H': { type: '机制工具双轮驱动', strategy: '在现有规则和工具基础上，加强跨部门团队协作与学术理念灌输。' },
    'L,L,H,H': { type: '团队工具执行型', strategy: '高位推动理念认同，优化院内准入机制与流程设计。' },
    'H,L,L,L': { type: '理念先行型', strategy: '将理念转化为实际机制，培育核心骨干团队。' },
    'L,H,L,L': { type: '机制防守型', strategy: '激发内部团队活力，加强临床学术覆盖。' },
    'L,L,H,L': { type: '团队孤岛型', strategy: '自下而上推动院内观念转变，争取药事机制突破。' },
    'L,L,L,H': { type: '重构工具型', strategy: '赋予工具灵魂，全面开展理念、机制和团队的系统性建设。' },
    'L,L,L,L': { type: '基础待开发型', strategy: '从零构建认知，锁定关键人物，启动基础破冰行动。' }
};
