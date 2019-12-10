interface FilterRetValue {
    text: string;
    filter: string[];
    pass?: boolean;
}

// 判定对象
interface JudgeObject {
    startIndex: number; // 这个对象生成的 index
    lastFindNodeIndex: number; // 找到上个节点 的index
    findNodeIndexArr: number[]; // 记录找到的节点的 index
    startNode: Node; // 存放开始节点
    prevNode?: Node; // 上一次找到的节点
    filterKey: string; // 存储当前敏感词，每次匹配到则自动合并过来
}

class Node {
    // 节点值
    public key: string;
    // 是否为单词最后节点
    public tail: boolean;
    // 父节点的引用
    public parent: Node | undefined;
    // 子节点的引用（goto表）
    public children: { [key: string]: Node } = {}
    // failure表，用于匹配失败后的跳转
    public failure: Node | undefined = undefined;

    constructor(key: string, parent: Node | undefined = undefined, tail: boolean = false) {
        this.key = key;
        this.parent = parent;
        this.tail = tail;
    }
}

class Tree {
    protected _root: Node;

    constructor() {
        this._root = new Node('root');
    }

    /**
     * 插入数据
     * @param str
     */
    public insert(str: string): boolean {
        if (!str) return false;
        let keyArr = str.split('');
        let firstKey = keyArr.shift();
        let children = this._root.children;
        let len = keyArr.length;
        let firstNode = children[firstKey];
        // 第一个key
        if (!firstNode) {
            children[firstKey] = new Node(firstKey, undefined, len == 0);
        } else if (!len) {
            firstNode.tail = true;
        }

        // 其他多余的key
        if (len >= 1) {
            this.insertNode(children[firstKey], keyArr);
        }
        return true;
    }

    /**
     * 插入节点
     * @param node
     * @param words
     */
    private insertNode(node: Node, words: string[]) {
        let len = words.length;
        if (len > 0) {
            let children: any;
            children = node.children;

            const key = words.shift();
            const isTail = len === 1;
            let item = children[key];

            if (!item) {
                item = new Node(key, node, isTail);
                item.tail = item.tail || isTail;
            } else {
                item.tail = isTail;
            }

            children[key] = item;
            this.insertNode(item, words);
        }
    }

    private getValues(o: any) {
        return Object.keys(o).map(k => o[k]);
    }

    /**
     * 创建Failure表
     */
    public createFailureTable() {
        // 获取树第一层
        let currQueue: Node[] = this.getValues(this._root.children);
        let depth = 0;
        while (currQueue.length > 0) {
            depth++;
            let nextQueue: Node[] = [];
            for (let i = 0; i < currQueue.length; i++) {
                let node = currQueue[i];
                let key = node.key;
                let parent = node.parent;
                node.failure = this._root;
                // 获取树下一层
                for (let k in node.children) {
                    nextQueue.push(node.children[k]);
                }
                if (parent) {
                    let failure: any = parent.failure;
                    while (failure) {
                        let children: any = failure.children[key];
                        // 判断是否到了根节点
                        if (children) {
                            node.failure = children;
                            break;
                        }
                        failure = failure.failure;
                    }
                }
            }

            currQueue = nextQueue;
        }
        return depth;
    }

    /**
     * 搜索节点
     * @param key
     * @param node
     */
    public search(key: string, nodeMap?: any): Node | undefined {
        nodeMap = nodeMap || this._root.children;
        return nodeMap[key];
    }
}

export class SensitiveWordFilter extends Tree {
    private _neglectwordsMap: { [index: string]: boolean } = {};
    private _replacement: string = '*';
    private _depth: number = 3;

    public createFailureTable() {
        this._depth = super.createFailureTable();
        return this._depth;
    }

    public setNeglectWords(words: string | string[]) {
        for (let i = 0; i < words.length; i++) {
            const key = words[i];
            this._neglectwordsMap[key] = true;
        }
    }

    private isNeglectWords(key: string) {
        return !!this._neglectwordsMap[key];
    }

    private check(str: string, every: boolean = false, replace: boolean = true): FilterRetValue {
        const strLen = str.length;
        let originStr = str;
        let filterKeywords: string[] = [];
        let judgeObjectList: { [key: string]: JudgeObject } = {};

        // 保存过滤文本
        let filterTextArr: string[] = originStr.split('');

        // 是否通过，无敏感词
        let isPass = true;

        // // 上一个Node与当前Node
        let currNode: Node | undefined;

        str = str.toLocaleUpperCase();
        for (let i = 0; i <= strLen; i++) {
            let key: string = str[i];
            let oriKey: string = originStr[i];
            // 如果是忽略的词组
            if (this.isNeglectWords(key)) {
                if (replace) {
                    filterTextArr[i] = oriKey;
                }
                continue;
            }
            if (!Object.keys(judgeObjectList).length) {
                currNode = this.search(key, this._root.children);

                if (!currNode) {
                    // 没有找到就直接拼接
                    if (replace) {
                        filterTextArr[i] = oriKey;
                    }
                    continue;
                }

                // 判断这个节点是否就是最后一个节点，针对的是单个字符的敏感词
                if (currNode.tail) {
                    filterTextArr[i] = this._replacement;
                    continue;
                }

                let judgeObject: JudgeObject = {
                    startIndex: i,
                    lastFindNodeIndex: i,
                    findNodeIndexArr: [i],
                    startNode: currNode,
                    prevNode: currNode,
                    filterKey: oriKey // 存储当前敏感词，每次匹配到则自动合并过来
                };
                judgeObjectList[String(i)] = judgeObject;
                continue;
            }

            // 分词数组中不为空
            for (let judgeKey in judgeObjectList) {
                const judgeObject = judgeObjectList[judgeKey];

                // 先判断有没有节点
                const currNode = this.search(key, judgeObject.prevNode.children);
                // 如果没有找到就去上一级
                if (!currNode) {
                    let failure: Node = judgeObject.prevNode.failure;
                    let cruNode: Node | undefined;
                    while (failure) {
                        cruNode = this.search(key, failure.children);
                        if (currNode) {
                            break;
                        }
                        failure = failure.failure;
                    }
                    if (cruNode) {
                        // 找到了就又往list 中插入一个分析对象
                        let judgeObject_: JudgeObject = {
                            startIndex: i,
                            lastFindNodeIndex: i,
                            findNodeIndexArr: [i],
                            startNode: cruNode,
                            prevNode: cruNode,
                            filterKey: oriKey // 存储当前敏感词，每次匹配到则自动合并过来
                        };
                        judgeObjectList[String(i)] = judgeObject_;
                    }
                }

                // 先判断这个划词对象是否超出树的最大深度
                if (i - judgeObject.lastFindNodeIndex > this._depth) {
                    // 那么跳过 ，并删除这个对象
                    delete judgeObjectList[judgeKey];
                }

                // 如果没有找到currNode 或者 超过了树的最大深度 那么就跳出当前循环
                if (!currNode || i - judgeObject.lastFindNodeIndex > this._depth) {
                    continue;
                }

                // 如果找到了
                // 判断tail 是否是 true
                const findNodeIndexArr = judgeObject.findNodeIndexArr.concat(i);
                const filterKey = judgeObject.filterKey + oriKey;
                if (currNode.tail) {
                    // 这里不清理这个对象的原因是可能后面还有tail 为 true 的情况
                    judgeObjectList[judgeKey] = {
                        startIndex: judgeObject.startIndex,
                        startNode: judgeObject.startNode,

                        findNodeIndexArr: findNodeIndexArr,
                        lastFindNodeIndex: i,
                        prevNode: currNode,
                        filterKey: filterKey
                    };
                    isPass = false;

                    if (every) {
                        break;
                    }

                    filterKeywords.push(filterKey);
                    if (replace) {
                        findNodeIndexArr.forEach(index => {
                            filterTextArr[index] = this._replacement;
                        });
                    }
                } else {// tail 不是true 的情况
                    judgeObjectList[judgeKey] = {
                        startIndex: judgeObject.startIndex,
                        startNode: judgeObject.startNode,
                        findNodeIndexArr: findNodeIndexArr,
                        lastFindNodeIndex: i,
                        prevNode: currNode,
                        filterKey: filterKey
                    };
                }
            }
        }

        return {
            text: replace ? filterTextArr.join('') : originStr,
            filter: filterKeywords,
            pass: isPass
        };
    }


    public every(word: string): boolean {
        return this.check(word, true).pass;
    }

    public filter(word: string, replace: boolean = true) {
        return this.check(word, false, replace);
    }

}

export default class SensitiveWordHelper {
    public static createFilter(arr: string[]) {
        let f = new SensitiveWordFilter();
        for (let i = 0; i < arr.length; i++) {
            const element = arr[i];
            f.insert(element);
        }
        f.createFailureTable();
        return f;
    }

    public static test() {
        let f = SensitiveWordHelper.createFilter(['淘宝', '拼多多', '京东', 'TEST', '宝瓶', '多特']);
        let ret = f.filter('双十一在淘宝买宝贝东西，618在京东买东西，当然你也可以在拼&x多x多买东西。宝瓶不是多特的。');
        f.setNeglectWords([' ', 'x', '&']);
        console.log(ret);
    }
}