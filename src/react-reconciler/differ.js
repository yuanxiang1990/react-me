import {tag,createFiber} from "./FiberNode";

/**
 * effect tag
 */
export const Effect = {
    PLACEMENT: 1,
    DELETION: 2,
    UPDATE: 3
}

function sameNode(oldNode, newNode) {
    return (
        oldNode && newNode && oldNode.tag === newNode.tag && oldNode.key === newNode.key
    )
}

function contains(a, obj) {
    var i = 0;
    while (i < a.length) {
        if (sameNode(a[i], obj)) {
            return a[i];
        }
        i++;
    }
    return false;
}

/**
 * 子节点differ算法
 * @param oldChildren
 * @param newChildren
 * @returns {{moves: Array, children: Array}}
 */
function differChildren(oldChildren, newChildren) {
    var newAdd = [], simulateArray = [], moves = [];
    var oldCopy = [].concat(oldChildren);


    /**
     * 首先保证新旧children相似，提升算法效率
     */
    for (var i = 0; i < oldCopy.length; i++) {
        var newNode = contains(newChildren, oldCopy[i]);
        if (!newNode) {
            oldCopy.splice(i, 1);
            remove(oldCopy[i]);
            i--;
        }
    }
    var newAddIndex = 0;
    for (var i = 0; i < newChildren.length; i++) {
        if (!contains(oldCopy, newChildren[i])) {
            newAdd.push(newChildren[i]);
            insert(newChildren[i]);
            newAddIndex++;
        }
    }
    simulateArray = oldCopy.concat(newAdd);

    var i = 0, j = 0;//i:simulate indx j:new array index
    while (j < newChildren.length) {
        var newItem = newChildren[j];
        if (sameNode(simulateArray[i], newChildren[j])) {
            i++;
            j++;
            continue;
        }
        if (simulateArray[i]) {
            if (sameNode(simulateArray[i + 1], newItem)) {
                simulateArray.splice(i, 1);
                remove(simulateArray[i]);
                i++;
                j++;
            } else {
                simulateArray.splice(i, 0, newItem);
                insert(newItem);
                i++;
                j++;
            }
        } else {
            simulateArray.push(newItem);
            insert(newItem);
            i++;
            j++;
        }
    }

    // 记录remove操作
    function remove(item) {
        item.effectTag = Effect.DELETION;
    }

    // 记录insert操作
    function insert(item) {
        item.effectTag = Effect.PLACEMENT;
    }

    /**
     * 移除多余的dom元素
     */
    while (simulateArray.length > newChildren.length) {
        simulateArray.splice(simulateArray.length - 1, 1);
        remove(simulateArray[simulateArray.length - 1]);
    }

    return {
        moves: moves
    }
}

/**
 * 链表换数组
 * @param fiber
 * @returns {Array}
 */
function fiberListToArray(fiber) {
    const children = [];
    if (fiber) {
        let sib = fiber.sibling;
        children.push(fiber)
        while (sib) {
            children.push(sib);
            sib = sib.sibling;
        }
    }
    return children
}


export function updateHostComponent(currentFiber) {
    let newFiber, element = currentFiber.props.children;
    if (!element) {
        return
    }
    if (Array.isArray(element) && element.length > 0) {
        let prevNode;
        element.forEach((ele, i) => {
            const firstEle = ele;
            let newSiblingFiber = new createFiber(tag.HostComponent,firstEle.type);
            newSiblingFiber.stateNode = document.createElement(firstEle.type);
            newSiblingFiber.return = currentFiber;
            newSiblingFiber.props = {
                children: firstEle.props.children
            }
            if (i === 0) {
                newFiber = newSiblingFiber;
            } else {
                prevNode.sibling = newSiblingFiber;
            }
            prevNode = newSiblingFiber;
        })
    } else {
        if(element.type) {
            newFiber = new createFiber(tag.HostComponent,element.type);
            newFiber.stateNode = document.createElement(element.type);
            newFiber.return = currentFiber;
            newFiber.props = {
                children: element.props ? element.props.children : null
            }
        }
        else{
            newFiber = new createFiber(tag.HostComponent,null);
            newFiber.stateNode = document.createTextNode(element);
            newFiber.return = currentFiber;
            newFiber.props = {}
        }
    }
    differChildren(fiberListToArray(currentFiber.child), fiberListToArray(newFiber));
    currentFiber.child = newFiber;
    return currentFiber.child;
}
