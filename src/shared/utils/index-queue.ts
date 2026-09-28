//目录队列节点
export class IndexQueueNode {
    depth: number;
    text: string;
    children: IndexQueue;
    constructor(depth: number, text: string) {
        this.depth = depth;
        this.text = text;
        this.children = new IndexQueue();
    }
}

//目录队列
export class IndexQueue {

    queue: IndexQueueNode[];

    constructor() {
        this.queue = [];
    }

    push(item: IndexQueueNode) {
        return this.queue.push(item);
    }

    /**
     * 弹出队首元素。
     * 注意：底层使用 shift() 为 O(n)（数组整体前移）。
     * 对于大列表的遍历请优先使用 `forEachSnapshot` / `toArray`，
     * 避免重复调用 pop() 造成 O(n²) 性能退化。
     */
    pop() {
        return this.queue.shift();
    }

    /**
     * 安全遍历快照：先复制数组，遍历副本。
     * 遍历过程中若对队列进行 push/pop，不影响本次遍历。
     */
    forEachSnapshot(callback: (node: IndexQueueNode, index: number) => void) {
        const snapshot = this.queue.slice();
        for (let i = 0; i < snapshot.length; i++) {
            callback(snapshot[i], i);
        }
    }

    /**
     * 返回队列快照数组（浅拷贝）。
     */
    toArray(): IndexQueueNode[] {
        return this.queue.slice();
    }

    getFront() {
        return this.queue[0];
    }
    getRear() {
        return this.queue[this.queue.length - 1]
    }

    clear() {
        this.queue = [];
    }

    isEmpty() {
        return this.queue.length === 0;
    }

    getSize(){
        return this.queue.length;
    }
}
