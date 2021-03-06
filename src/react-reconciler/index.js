import {
    NoWork,
    Never,
    Sync,
    noTimeout,
    maxSigned31BitInt,
    originalStartTimeMs,
    msToExpirationTime,
    MAGIC_NUMBER_OFFSET,
    UNIT_SIZE,
    computeInteractiveExpiration,
    computeAsyncExpiration
} from "./ReactFiberExpirationTime.js";
/**
 * TODO 任务插队优化！！
 */
import {tag, FiberNode, getRootFiber} from "./FiberNode";
import {updateHostComponent, updateClassComponent, Effect} from "./differ";
import {isEmptyObject} from "../utils/index";
import {finalizeInitialFiber} from "../react-event"
import {commitAfterLifeCycle, commitAllWork, commitPreLifeCycle} from "./commitWork";

let isRendering = false;//是否正在渲染包括reconcile阶段和commit阶段
let currentSchedulerTime = maxSigned31BitInt - Date.now();
let nextFlushedExpirationTime = NoWork;
let currentRendererTime = msToExpirationTime(originalStartTimeMs);
// The time at which we're currently rendering work.
let nextRenderExpirationTime = NoWork;//正在渲染的任务的优先级！！！
let isWorking = false;
let isCommitting = false;
let isBatchingInteractiveUpdates = false;//是否高优先级更新，如用户交互等
let isBatchingUpdates = false;//是否合成更新
let workInProgress = null;//当前工作树
let nextUnitOfWork = null;//下一工作单元的任务
let pendingCommit;
let nextFlushedRoot = null;
const rootQueue = [];
/**
 * class类型组件相关方法
 * @type {{enqueueSetState: classComponentUpdater.enqueueSetState}}
 */
const classComponentUpdater = {
    enqueueSetState: function (inst, payload) {
        const fiber = inst._reactInternalFiber;
        const currentTime = requestCurrentTime();
        const expirationTime = computeExpirationForFiber(currentTime, fiber);
        if (expirationTime > nextRenderExpirationTime) {//更高优先级任务到来时终止当前任务
            nextUnitOfWork = null;
            nextRenderExpirationTime = NoWork;
        }
        fiber.updateQueue.push({
            expirationTime,
            payload
        })
        scheduleWork(fiber, expirationTime);
    }
}


export function updateContainer(children, containerFiberRoot) {
    let root = containerFiberRoot;
    let currentTime = requestCurrentTime();
    let expirationTime = computeExpirationForFiber(currentTime, root);
    root.expirationTime = expirationTime;
    root.lowestPendingTime = NoWork;
    root.highestPendingTime = NoWork;
    root.updateQueue.push({
        element: children
    })
    return updateContainerAtExpirationTime(root, expirationTime)
}

function updateContainerAtExpirationTime(currentFiber, expirationTime) {
    currentFiber.expirationTime = expirationTime;
    scheduleWork(currentFiber, expirationTime)
}


function scheduleWork(fiber, expirationTime) {
    const root = getRootFiber(fiber);
    root.expirationTime = expirationTime;
    root.isSync = false;
    markPendingPriorityLevel(root, expirationTime);
    addRootToSchedule(root, expirationTime);

    /**
     * 合并更新参数控制，事件回调当中如果有多个setState为了提升效率，
     * 不会立即触发reconcile和commit，只是将要更新的root放入更新队列当中，回调完成后再一起更新
     */
    if (isBatchingUpdates) {
        return;
    }

    requestWork(root, expirationTime);
}


/**
 * 该方法用于标记当前root的最高优先级任务和最低优先级任务，用commit完成之后，判断是否还有更多的任务
 * @param root
 * @param expirationTime
 */
function markPendingPriorityLevel(root, expirationTime) {
    console.log(root.lowestPendingTime, root.highestPendingTime, expirationTime, 9090)
    if (root.lowestPendingTime === NoWork && root.highestPendingTime === NoWork) {
        root.lowestPendingTime = root.highestPendingTime = expirationTime;
    }
    else if (root.lowestPendingTime > expirationTime) {
        root.lowestPendingTime = expirationTime;
    }
    else if (root.highestPendingTime < expirationTime) {
        root.highestPendingTime = expirationTime;
    }
}

function requestWork(root, expirationTime) {
    if (isRendering) {
        //当前正在渲染时先不执行，最后一次再一起执行
        return
    }
    if (expirationTime === Sync) {
        performSyncWork(root);
    } else {
        performAsyncWork(root, expirationTime);
    }
}

/**
 * @param root
 * @param expirationTime
 */
function addRootToSchedule(root, expirationTime) {
    let isAdd = false;
    for (let i = 0, len = rootQueue.length; i < len; i++) {
        if (rootQueue[i] === root) {
            if (expirationTime > rootQueue[i].expirationTime) {
                rootQueue[i].expirationTime = expirationTime;
            }
            isAdd = true;
            break
        }
    }
    if (!isAdd) {
        rootQueue.push(root);
    }
}


function findHighestPriorityRoot() {
    let highestPriorityWork = NoWork;
    let highestPriorityRoot = null;
    for (let i = 0, len = rootQueue.length; i < len; i++) {
        if (rootQueue[i].expirationTime !== NoWork) {
            if (rootQueue[i].expirationTime > highestPriorityWork) {
                highestPriorityRoot = rootQueue[i];
                highestPriorityWork = highestPriorityRoot.expirationTime;
            }
            if (highestPriorityWork === Sync) {
                break
            }

        }
    }
    nextFlushedRoot = highestPriorityRoot;
    nextFlushedExpirationTime = highestPriorityWork;
}

export function performSyncWork() {
    performWork(null)
}

function performAsyncWork(root, expirationTime) {
    recomputeCurrentRendererTime();
    requestIdleCallback((deadline) => {
        return performWork(deadline)
    })
}

function performWork(deadline) {
    findHighestPriorityRoot();
    while (nextFlushedRoot !== null && nextFlushedExpirationTime !== NoWork) {
        let res = null;
        if (nextFlushedRoot.expirationTime === Sync) {
            res = performWorkOnRoot(null, nextFlushedRoot);
        }
        else {
            res = performWorkOnRoot(deadline, nextFlushedRoot)
        }
        if (res && res.status === "timeout") {
            break;
        }
        else {
            findHighestPriorityRoot();
        }
    }
}

/**
 *
 * @param deadline
 * @param root 参数可不传，任务中断在恢复时不需要root
 */
function performWorkOnRoot(deadline, root) {
    isWorking = true;
    isRendering = true;
    if (nextUnitOfWork == null) {
        workInProgress = createWorkInProgress(root);
        nextUnitOfWork = workInProgress;
        nextRenderExpirationTime = workInProgress.expirationTime;
    }
    try {
        workLoop(deadline,root);
    }
    catch (e) {
        console.error(e);
        nextUnitOfWork = throwException(nextUnitOfWork, e);
    }
    recomputeCurrentRendererTime();
    let expirationTime = workInProgress.expirationTime;
    //继续处理回调
    if (nextUnitOfWork) {
        if (deadline && deadline.timeRemaining() === 0) {//帧超时退出
            requestIdleCallback((deadline) => {
                performWork(deadline);
            })
            isWorking = false;
            isRendering = false;
            return {
                status: "timeout"
            }
        }
        else {//错误异常退出等。。。
            performWork(deadline);
            return {
                status: "error"
            }
        }
    }
    /**
     * 任务已处理完，直接进入commit阶段
     * TODO 此处应还包括任务打断处理！！
     */
    else {
        commitPreLifeCycle(pendingCommit);
        isCommitting = true;
        commitAllWork(pendingCommit);
        commitAfterLifeCycle(pendingCommit);
        //当前任务是最低优先级任务，改root节点的任务已经执行完成，直接结束。
        console.log(expirationTime,root.lowestPendingTime,root.highestPendingTime)
        if (expirationTime === root.lowestPendingTime) {
            root.highestPendingTime = NoWork;
            root.lowestPendingTime = NoWork;
            root.expirationTime = NoWork;
            rootQueue.splice(rootQueue.indexOf(nextFlushedRoot), 1);
            /**
             * 所有队列的任务都已经执行完
             */
            if(rootQueue.length===0){
                root.alternate.highestPendingTime = NoWork;
                root.alternate.lowestPendingTime = NoWork;
                root.alternate.expirationTime = NoWork;
            }
        }
        else {
            rootQueue.splice(rootQueue.indexOf(nextFlushedRoot), 1);
            pendingCommit.expirationTime = root.nextExpirationTime;
            pendingCommit.highestPendingTime = root.nextExpirationTime;
            addRootToSchedule(pendingCommit, root.nextExpirationTime);
        }
        pendingCommit.effects = [];
        isCommitting = false;
        isRendering = false;
        isWorking = false;
        nextRenderExpirationTime = NoWork;
    }
}

function throwException(workInProgress, error) {
    do {
        workInProgress = workInProgress.return;
        switch (workInProgress.tag) {
            case tag.HostRoot:
                //TODO:根节点错误处理
                return workInProgress
            case tag.ClassComponent:
                const getDerivedStateFromError = workInProgress.stateNode.constructor.getDerivedStateFromError;
                const componentDidCatch = workInProgress.stateNode.componentDidCatch;
                if (typeof getDerivedStateFromError === "function") {
                    workInProgress.updateQueue.push({
                        payload: getDerivedStateFromError(error)
                    });
                }
                if (typeof componentDidCatch === "function") {
                    workInProgress.updateQueue.push({
                        callback: () => componentDidCatch(error)
                    });
                }
                if (typeof getDerivedStateFromError === "function" || typeof componentDidCatch === "function") {
                    return workInProgress;
                }

        }
    } while (workInProgress !== null);
}

function workLoop(deadline,root) {
    if (deadline) {
        while (nextUnitOfWork && deadline.timeRemaining() > 0) {
            nextUnitOfWork = performUnitWork(nextUnitOfWork,root);
        }
    }
    else {
        while (nextUnitOfWork) {
            nextUnitOfWork = performUnitWork(nextUnitOfWork,root);
        }
    }
}


function performUnitWork(nextUnitOfWork,root) {
    const currentFiber = nextUnitOfWork;
    const nextChild = beginWork(currentFiber,root);
    finalizeInitialFiber(currentFiber, root)
    if (nextChild) return nextChild;
    let topFiber = currentFiber;
    while (topFiber) {
        completeWork(topFiber);
        if (topFiber.sibling) {
            return topFiber.sibling
        }
        else {
            topFiber = topFiber.return;
        }
    }
    return null;

}

/**
 * 搜集节点变更到根节点
 * @param workInProgress
 */
function completeWork(workInProgress) {
    if (workInProgress.return) {
        const currentEffect = (workInProgress.effects) || [] //收集当前节点的 effect list
        const currentEffectTag = (workInProgress.effectTag) ? [workInProgress] : []
        const parentEffects = workInProgress.return.effects || [];
        workInProgress.return.effects = parentEffects.concat(currentEffect, currentEffectTag)
    } else {
        // 到达最顶端了
        pendingCommit = workInProgress
    }

}

function beginWork(workInProgress,root) {
    workInProgress.effects.length = 0;
    switch (workInProgress.tag) {
        case tag.ClassComponent: {//处理class类型组件
            /**
             * 需从updateQueue中筛选出优先级最高的任务执行
             */
            let baseState =  {};//记录已经执行了的状态
            console.log(workInProgress.updateQueue.slice(0))
            workInProgress.updateQueue.forEach((item, i) => {
                if (root.highestPendingTime === item.expirationTime) {
                    baseState = Object.assign(baseState, item.payload);
                    workInProgress.updateQueue.splice(i, 1);
                }
            })
            root.nextExpirationTime = root.nextExpirationTime || NoWork;
            workInProgress.updateQueue.forEach((item) => {
                if (item.expirationTime > root.nextExpirationTime) {
                    root.nextExpirationTime = item.expirationTime;
                }
            })
            if (!isEmptyObject(baseState)) {
                workInProgress.stateNode._partialState = baseState;
                workInProgress.effectTag = Effect.UPDATE;
            }
            workInProgress.stateNode.updater = classComponentUpdater;
            return updateClassComponent(workInProgress);
        }
        case tag.HostRoot: {
            const update = workInProgress.updateQueue.shift();
            if (update) {
                workInProgress.props.children = update.element;
            }
            return updateHostComponent(workInProgress);
        }
        default: {
            return updateHostComponent(workInProgress);
        }
    }
}

export function createWorkInProgress(current) {
    let workInProgress = current.alternate;
    if (workInProgress === null) {
        workInProgress = new FiberNode(current.tag);
        workInProgress.alternate = current;
        workInProgress.stateNode = current.stateNode;
        workInProgress.props = current.props || {};
        workInProgress.expirationTime = current.expirationTime;
        current.alternate = workInProgress;
    } else {
        workInProgress.effects = [];
        workInProgress.props = current.props;
    }
    workInProgress.type = current.type;
    workInProgress.child = current.child;
    workInProgress.expirationTime = current.expirationTime;
    workInProgress.updateQueue = current.updateQueue;
    workInProgress.lowestPendingTime = current.lowestPendingTime;
    workInProgress.highestPendingTime = current.highestPendingTime;
    return workInProgress;
}

function requestCurrentTime() {

    if (isRendering) {
        // We're already rendering. Return the most recently read time.
        return currentSchedulerTime;
    }

    if (nextFlushedExpirationTime === NoWork || nextFlushedExpirationTime === Never) {
        // If there's no pending work, or if the pending work is offscreen, we can
        // read the current time without risk of tearing.
        recomputeCurrentRendererTime();
        currentSchedulerTime = currentRendererTime;
        return currentSchedulerTime;
    }
    // There's already pending work. We might be in the middle of a browser
    // event. If we were to read the current time, it could cause multiple updates
    // within the same event to receive different expiration times, leading to
    // tearing. Return the last read time. During the next idle callback, the
    // time will be updated.
    //和接下来要执行的任务返回相同的时间，避免一次时间里出现多次更新
    return currentSchedulerTime;
}

function recomputeCurrentRendererTime() {
    let currentTimeMs = Date.now() - originalStartTimeMs;
    currentRendererTime = msToExpirationTime(currentTimeMs);
}

function computeExpirationForFiber(currentTime, fiber) {
    let expirationTime;
    if (isWorking) {
        if (isCommitting) {//
            expirationTime = Sync;//同步任务优先级最高
        } else {
            expirationTime = nextRenderExpirationTime
        }
    } else {
        if (fiber.isSync) {
            return Sync;
        }
        if (isBatchingInteractiveUpdates) {//优先级较高的任务如用户交互等
            expirationTime = computeInteractiveExpiration(currentTime);//计算出的值较大，优先级高
        } else {//普通异步任务
            expirationTime = computeAsyncExpiration(currentTime);//计算的值较小，优先级低
        }
    }
    return expirationTime
}

export function setBatchingInteractiveUpdates(val) {
    isBatchingInteractiveUpdates = val;
}

export function setBatchingUpdates(val) {
    isBatchingUpdates = val;
}

export function getBatchingUpdates() {
    return isBatchingUpdates;
}