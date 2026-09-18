#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把 CRAC 2025 年版 A/B/C 三类题库 CSV 构造成练题网站可加载的数据文件。

输入：data/{class_a.csv,class_b.csv,class_c.csv,images.csv,images_2/*}
输出：web/data/exam.js  (window.__EXAM_DATA__ = { a: {...}, b: {...}, c: {...} })
      web/images/*.jpg   (题图，按 <类名><序号> 去重命名)

数据目录可用环境变量 HAM_DATA_DIR 覆盖，默认为仓库根下的 data/。
"""
import csv
import json
import os
import shutil
from collections import defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.environ.get("HAM_DATA_DIR") or os.path.join(ROOT, "data")
WEB = os.path.join(ROOT, "web")

# ---------------------------------------------------------------- 章节名称表
CHAPTERS = {
    "1": "法规与频率管理",
    "2": "国际规则与通联操作",
    "3": "设备、天线与电波传播",
    "4": "电工电子基础",
    "5": "安全与电磁兼容",
}

# 二级小节名称：以 B 类为基准（最全），A/C 复用之；缺失的按编号兜底
GROUPS = {
    "1.1": "无线电管理法规体系",
    "1.2": "业余电台的设置与执照",
    "1.3": "操作技术能力验证",
    "1.4": "业余电台呼号",
    "1.5": "使用规范与应急通信",
    "1.6": "监督检查与法律责任",
    "1.7": "业余频段使用规定",
    "2.1": "国际频率划分与分区",
    "2.2": "呼叫、守听与电台日志",
    "2.3": "通联英语与 CW 操作",
    "2.4": "通信缩语与 Q 简语",
    "2.5": "发射类别与调制方式",
    "2.6": "模拟与数字通信方式",
    "2.7": "DX 通联、竞赛与定位",
    "3.1": "中继台与台站配套设备",
    "3.2": "收发信机操作部件",
    "3.3": "天线与馈线基础",
    "3.4": "常用天线形式与天调",
    "3.5": "传输线与电波传播",
    "3.6": "设备技术指标与测量",
    "3.7": "无线电测向与数据通信",
    "3.8": "业余卫星",
    "4.1": "电学基础与电源",
    "4.2": "欧姆定律与交流电",
    "4.3": "电子元器件",
    "4.4": "电路分析",
    "4.5": "数字逻辑电路",
    "4.6": "电路图表与测量",
    "5.1": "电磁环境与用电安全",
}

# 各类别的考试规则（题数/单选/多选/时长/合格分）
EXAM_RULES = {
    "a": {"count": 30, "single": 25, "multi": 5, "minutes": 30, "pass": 25, "verify": True},
    "b": {"count": 60, "single": 45, "multi": 15, "minutes": 60, "pass": 45, "verify": False},
    "c": {"count": 80, "single": 60, "multi": 20, "minutes": 90, "pass": 60, "verify": True},
}

# 解析数据（由 scripts/gen_explanations.py 生成），键为题目 code -> 解析文本
EXPLANATIONS_PATH = os.path.join(ROOT, "data", "explanations_b.json")


def load_explanations():
    """载入解析（仅 B 类）。返回 {code: 解析文本}。"""
    if not os.path.exists(EXPLANATIONS_PATH):
        return {}
    with open(EXPLANATIONS_PATH, encoding="utf-8") as f:
        return json.load(f)

CLASS_LABEL = {"a": "A 类", "b": "B 类", "c": "C 类"}


def sec_key(s):
    return [int(x) for x in s.split(".")]


def build_class(klass, img_of_label, explanations):
    """编译单个类别，返回 {meta, q}，并复制题图。"""
    csv_path = os.path.join(SRC, "class_%s.csv" % klass)
    rows = list(csv.reader(open(csv_path, encoding="utf-8-sig", newline="")))[1:]

    out = []
    problems = []
    imgdir = os.path.join(WEB, "images")
    os.makedirs(imgdir, exist_ok=True)
    used_imgs = {}

    for idx, r in enumerate(rows, 1):
        while len(r) < 9:
            r.append("")
        label, leaf, code, stem, ans, *opts = r[:9]
        code = code.split(",")[0].strip()
        stem = stem.strip()
        opts = [o.strip() for o in opts]
        ans = ans.strip().upper()

        # 丢空白选项
        opts = [o for o in opts if o]
        if len(opts) < 2 or not stem or not ans:
            problems.append((idx, code, "字段缺失"))
            continue
        letters = list(ans)
        ai = []
        for ch in letters:
            k = ord(ch) - ord("A")
            if 0 <= k < len(opts):
                ai.append(k)
        if not ai:
            problems.append((idx, code, "答案越界"))
            continue

        # 配图（用类别前缀避免 A/B/C 之间编号冲突）
        img = None
        if label in img_of_label:
            src_img = os.path.join(SRC, "images_2", label + ".jpg")
            if not os.path.exists(src_img):
                src_img = os.path.join(SRC, "images", img_of_label[label])
            if os.path.exists(src_img):
                fname = f"{klass}_q{idx:04d}.jpg"
                shutil.copyfile(src_img, os.path.join(imgdir, fname))
                img = "images/" + fname
                used_imgs[label] = fname

        sec2 = ".".join(leaf.split(".")[:2])
        out.append(
            {
                "i": idx,
                "c": code,
                "l": label,
                "g": sec2,
                "s": leaf,
                "t": 0 if len(ai) == 1 else 1,
                "q": stem,
                "o": opts,
                "a": ai,
                "m": img,
                "e": explanations.get(code, ""),
            }
        )

    # ---------------------------------------------------------- 汇总
    groups = defaultdict(list)
    for q in out:
        groups[q["g"]].append(q["i"])

    chapters = defaultdict(lambda: defaultdict(list))
    for g, ids in groups.items():
        chapters[g.split(".")[0]][g] = ids

    meta_groups = []
    for cid in sorted(chapters, key=lambda x: int(x)):
        gs = []
        for g in sorted(chapters[cid], key=sec_key):
            ids = sorted(chapters[cid][g])
            gs.append(
                {
                    "g": g,
                    "name": GROUPS.get(g, g),
                    "n": len(ids),
                    "single": sum(1 for i in ids if out[i - 1]["t"] == 0),
                    "multi": sum(1 for i in ids if out[i - 1]["t"] == 1),
                }
            )
        meta_groups.append(
            {
                "id": cid,
                "name": CHAPTERS.get(cid, "第" + cid + "章"),
                "n": sum(x["n"] for x in gs),
                "single": sum(x["single"] for x in gs),
                "multi": sum(x["multi"] for x in gs),
                "groups": gs,
            }
        )

    rule = EXAM_RULES[klass]
    data = {
        "meta": {
            "title": "业余无线电台操作技术能力验证题库（2025年版）",
            "klass": CLASS_LABEL[klass],
            "klassKey": klass,
            "version": "2025年版",
            "source": "中国无线电协会业余无线电分会（CRAC）",
            "total": len(out),
            "single": sum(1 for q in out if q["t"] == 0),
            "multi": sum(1 for q in out if q["t"] == 1),
            "imaged": len(used_imgs),
            "exam": {
                "count": rule["count"],
                "single": rule["single"],
                "multi": rule["multi"],
                "minutes": rule["minutes"],
                "pass": rule["pass"],
                "verify": rule["verify"],
            },
            "chapters": meta_groups,
        },
        "q": out,
    }
    return data, problems, used_imgs, meta_groups


def main():
    # ---------------------------------------------------------- 配图映射
    img_of_label = {}
    ip = os.path.join(SRC, "images.csv")
    if os.path.exists(ip):
        for row in csv.DictReader(open(ip, encoding="utf-8-sig")):
            if row.get("J") and row.get("ImagePath"):
                img_of_label[row["J"].strip()] = os.path.basename(row["ImagePath"].strip())

    all_data = {}
    explanations = load_explanations()
    for klass in ("a", "b", "c"):
        data, problems, used_imgs, meta_groups = build_class(klass, img_of_label, explanations)
        all_data[klass] = data
        print("=" * 60)
        print(f"[{CLASS_LABEL[klass]}] 题目 {data['meta']['total']}  单选 {data['meta']['single']}  多选 {data['meta']['multi']}  配图 {len(used_imgs)}")
        print(f"  考试规则: {data['meta']['exam']['count']}题/{data['meta']['exam']['minutes']}分钟/答对{data['meta']['exam']['pass']}题" +
              ("（待核实）" if data['meta']['exam']['verify'] else ""))
        print(f"  问题: {len(problems)} 条" + (f" -> {problems[:5]}" if problems else ""))
        for c in meta_groups:
            print(f'    {c["id"]}. {c["name"]}  {c["n"]}题 (单{c["single"]}/多{c["multi"]})')

    os.makedirs(os.path.join(WEB, "data"), exist_ok=True)
    dest = os.path.join(WEB, "data", "exam.js")
    with open(dest, "w", encoding="utf-8") as f:
        f.write("/* 数据源：CRAC《业余无线电台操作技术能力验证题库（2025年版）》A/B/C 类 · 自动生成，勿手改 */\n")
        f.write("window.__EXAM_DATA__ = ")
        json.dump(all_data, f, ensure_ascii=False, separators=(",", ":"))
        f.write(";\n")

    total = sum(all_data[k]["meta"]["total"] for k in all_data)
    print("=" * 60)
    print("总题量:", total, "->", dest, os.path.getsize(dest), "bytes")


if __name__ == "__main__":
    main()
