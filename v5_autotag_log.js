// Faceted Taxonomy Tagger for Zotero
// 专为交叉学科（物理硬件+AI算法）设计的本地自动化正交打标脚本

const WRITE = true; // 【安全开关】设为 false 时为测试模式，只统计不实际修改数据库；确认无误后设为 true
const SLEEP_MS = 15; // 批处理休眠时间，防止处理一千多篇文献时 Zotero UI 卡死

// 1. 定义正交标签字典 (支持跨维度交叉匹配，一篇文献可同时命中多个维度的标签)
const rules = [
    // 维度 A：研究方向 (Topic)
    { regex: /\b(nv|nitrogen[- ]vacancy|diamond|magnetic sensing|magnetometer)\b/i, tag: 'Topic/NVMagnetometry' },
    { regex: /\b(fiber|optic|interferometer|mach-zehnder|bragg|fbg)\b/i, tag: 'Topic/FiberOptics' },
    { regex: /\b(plasmon|plasmonic|spr|surface plasmon)\b/i, tag: 'Topic/Plasmonics_SPR' },
    { regex: /\b(biosensor|biosensing|glucose|protein|dna|aptamer)\b/i, tag: 'Topic/Biosensing' },
    { regex: /\b(quantum|spin|qubit|entanglement)\b/i, tag: 'Topic/QuantumPhysics' },
    
    // 维度 B：算法与计算 (Algo)
    { regex: /\b(tinyml|edge computing|microcontroller|mcu|fpga|accelerator)\b/i, tag: 'Algo/TinyML' },
    { regex: /\b(machine learning|deep learning|neural network|cnn|rnn|transformer|ai)\b/i, tag: 'Algo/DeepLearning' },
    { regex: /\b(optimization|genetic algorithm|particle swarm|bayesian)\b/i, tag: 'Algo/Optimization' },
    { regex: /\b(signal processing|denoising|fourier|filter|wavelet)\b/i, tag: 'Algo/SignalProcessing' },

    // 维度 C：材料与物质 (Material)
    { regex: /\b(graphene|cnt|carbon nanotube)\b/i, tag: 'Material/CarbonNanomaterials' },
    { regex: /\b(diamond|nanodiamond|bulk diamond)\b/i, tag: 'Material/Diamond' },
    { regex: /\b(metal oxide|zno|tio2|ito)\b/i, tag: 'Material/MetalOxide' },

    // 维度 D：技术与方法 (Method)
    { regex: /\b(odmr|ramsey|hahn echo|dynamical decoupling)\b/i, tag: 'Method/QuantumControl' },
    { regex: /\b(cvd|chemical vapor deposition|implantation|annealing)\b/i, tag: 'Method/Fabrication' }
];

// 休眠函数定义
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// 主逻辑入口
const libraryID = Zotero.Libraries.userLibraryID;
var s = new Zotero.Search();
s.libraryID = libraryID;
var itemIDs = await s.search();
var items = await Zotero.Items.getAsync(itemIDs);

let processedTotal = 0;
let taggedCount = 0;
let addedTagsTotal = 0;

for (let item of items) {
    // 极其重要的防呆机制：仅处理常规文献条目，跳过附件(PDF)、独立笔记等
    if (!item.isRegularItem()) continue; 
    
    let title = item.getField('title') || "";
    let abstract = item.getField('abstractNote') || "";
    let textToSearch = (title + " " + abstract).toLowerCase();
    
    let updated = false;
    let addedTagsThisItem = [];

    // 正交遍历匹配核心逻辑
    for (let rule of rules) {
        if (rule.regex.test(textToSearch)) {
            // 幂等性检查：查阅该条目的现有标签，如果不存在才添加
            if (!item.hasTag(rule.tag)) {
                if (WRITE) {
                    item.addTag(rule.tag);
                }
                addedTagsThisItem.push(rule.tag);
                updated = true;
                addedTagsTotal++;
            }
        }
    }
    
    // 数据库事务提交回写
    if (updated) {
        if (WRITE) {
            await item.saveTx();
        }
        taggedCount++;
        // 记录底层日志，可在 Zotero 控制台查看具体打了哪些标签
        Zotero.debug(`已为条目 [${item.id}] 追加标签: ${addedTagsThisItem.join(", ")}`);
    }
    
    processedTotal++;
    
    // 批处理防卡死机制：每处理 50 篇文献，释放一次主线程
    if (processedTotal % 50 === 0) {
        await sleep(SLEEP_MS);
    }
}

// 最终返回执行报告
return `✅ 自动化打标执行完毕！\n` +
       `============================\n` +
       `当前写入模式 (WRITE) : ${WRITE ? "开启 (已修改数据库)" : "关闭 (仅安全测试)"}\n` +
       `共扫描有效文献 : ${processedTotal} 篇\n` +
       `实际发生修改的文献 : ${taggedCount} 篇\n` +
       `总计新增交叉标签 : ${addedTagsTotal} 个\n` +
       `============================`;