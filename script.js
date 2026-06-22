// ============================================================================
// MODULE 1: VIRTUAL DOM & CREATE ELEMENT
// ============================================================================
function createElement(type, props, ...children) {
  props = props || {};
  // Flatten children array to handle nested loops or conditionals smoothly
  const flatChildren = children.flat(Infinity).map(child => {
    if (typeof child === 'object' && child !== null) {
      return child;
    }
    // Handle text or number primitives explicitly as virtual text nodes
    return { type: 'TEXT_ELEMENT', props: { nodeValue: child, children: [] } };
  });

  return {
    type,
    props: {
      ...props,
      children: flatChildren
    },
    key: props.key ?? null
  };
}

const isEvent = key => key.startsWith("on");
const isProperty = key => key !== "children" && !isEvent(key) && key !== "key";

function createDOMNode(vNode) {
  if (!vNode) return null;

  // Handle virtual text elements
  if (vNode.type === 'TEXT_ELEMENT') {
    return document.createTextNode(vNode.props.nodeValue ?? '');
  }

  // Handle Component functional evaluations
  if (typeof vNode.type === 'function') {
    const expandedVNode = vNode.type(vNode.props);
    const dom = createDOMNode(expandedVNode);
    dom._vNode = expandedVNode; // Cache layout for reconciliation steps
    return dom;
  }

  // Normal Native HTML element generation
  const dom = document.createElement(vNode.type);

  // Bind properties
  Object.keys(vNode.props)
    .filter(isProperty)
    .forEach(name => {
      dom[name] = vNode.props[name];
    });

  // Bind Event Listeners
  Object.keys(vNode.props)
    .filter(isEvent)
    .forEach(name => {
      const eventType = name.toLowerCase().substring(2);
      dom.addEventListener(eventType, vNode.props[name]);
    });

  // Recursively append child nodes
  vNode.props.children.forEach(child => {
    const childDom = createDOMNode(child);
    if (childDom) dom.appendChild(childDom);
  });

  return dom;
}

function render(vNode, container) {
  container.innerHTML = "";
  const rootDom = createDOMNode(vNode);
  if (rootDom) {
    container.appendChild(rootDom);
    container._currentVNode = vNode; // Reference snapshot tracking
  }
}

// ============================================================================
// MODULE 2 & 3: DIFF & RECONCILIATION
// ============================================================================
function diff(parentDOM, oldVNode, newVNode, index = 0) {
  const childDOM = parentDOM.childNodes[index];

  // 1. Append if an element is added
  if (!oldVNode) {
    if (newVNode) {
      parentDOM.appendChild(createDOMNode(newVNode));
    }
    return;
  }

  // 2. Drop node if structural layout removed it
  if (!newVNode) {
    if (childDOM) {
      parentDOM.removeChild(childDOM);
    }
    return;
  }

  // Unpack operational component nodes
  let realOld = oldVNode;
  if (typeof oldVNode.type === 'function' && childDOM && childDOM._vNode) {
    realOld = childDOM._vNode;
  }
  
  let realNew = newVNode;
  let newlyExpanded = null;
  if (typeof newVNode.type === 'function') {
    newlyExpanded = newVNode.type(newVNode.props);
    realNew = newlyExpanded;
  }

  // 3. Swap node tree clean if root tags differ
  if (realOld.type !== realNew.type) {
    const newDOM = createDOMNode(newVNode);
    if (childDOM) {
      parentDOM.replaceChild(newDOM, childDOM);
    } else {
      parentDOM.appendChild(newDOM);
    }
    return;
  }

  // 4. Update modified pure Text values
  if (realNew.type === 'TEXT_ELEMENT') {
    if (realOld.props.nodeValue !== realNew.props.nodeValue) {
      childDOM.nodeValue = realNew.props.nodeValue;
    }
    return;
  }

  // 5. Update attributes and handlers
  if (childDOM) {
    // Clear old properties
    Object.keys(realOld.props)
      .filter(isProperty)
      .forEach(name => {
        if (!(name in realNew.props)) childDOM[name] = "";
      });

    // Write updated properties
    Object.keys(realNew.props)
      .filter(isProperty)
      .forEach(name => {
        if (realOld.props[name] !== realNew.props[name]) {
          childDOM[name] = realNew.props[name];
        }
      });

    // Clean old event listeners
    Object.keys(realOld.props)
      .filter(isEvent)
      .forEach(name => {
        const eventType = name.toLowerCase().substring(2);
        childDOM.removeEventListener(eventType, realOld.props[name]);
      });

    // Register active event listeners
    Object.keys(realNew.props)
      .filter(isEvent)
      .forEach(name => {
        const eventType = name.toLowerCase().substring(2);
        childDOM.addEventListener(eventType, realNew.props[name]);
      });

    if (newlyExpanded) {
      childDOM._vNode = newlyExpanded;
    }
  }

  // 6. Reconcile Children Array
  const oldChildren = realOld.props.children || [];
  const newChildren = realNew.props.children || [];
  const targetParentDOM = childDOM || parentDOM;

  // Build identity keys map for list updates tracking
  const oldKeys = {};
  oldChildren.forEach((child, i) => {
    if (child && child.key !== null) {
      oldKeys[child.key] = { vNode: child, index: i };
    }
  });

  if (Object.keys(oldKeys).length > 0 && newChildren.some(c => c && c.key !== null)) {
    // Key-aware layout matching
    const remainingOldChildren = [...targetParentDOM.childNodes];
    targetParentDOM.innerHTML = "";

    newChildren.forEach((newChild) => {
      if (!newChild) return;
      
      if (newChild.key !== null && oldKeys[newChild.key] !== undefined) {
        const match = oldKeys[newChild.key];
        const matchingDOM = remainingOldChildren[match.index];
        targetParentDOM.appendChild(matchingDOM);
        diff(targetParentDOM, match.vNode, newChild, targetParentDOM.childNodes.length - 1);
      } else {
        targetParentDOM.appendChild(createDOMNode(newChild));
      }
    });
  } else {
    // Positional reconciliation index fallbacks
    const maxLen = Math.max(oldChildren.length, newChildren.length);
    let offset = 0;
    for (let i = 0; i < maxLen; i++) {
      const oldC = oldChildren[i];
      const newC = newChildren[i];
      
      if (!oldC && newC) {
        diff(targetParentDOM, oldC, newC, targetParentDOM.childNodes.length);
      } else if (oldC && !newC) {
        diff(targetParentDOM, oldC, newC, i - offset);
        offset++;
      } else {
        diff(targetParentDOM, oldC, newC, i - offset);
      }
    }
  }
}

// ============================================================================
// MODULE 4 & 5: STATE, HOOKS & SCHEDULER
// ============================================================================
let globalState = {
  hooks: [],
  hookIndex: 0,
  rootComponent: null,
  containerDOM: null
};

let isScheduled = false;

function scheduleRender() {
  if (isScheduled) return;
  isScheduled = true;
  
  // Batch re-renders efficiently using microtask boundaries
  queueMicrotask(() => {
    isScheduled = false;
    globalState.hookIndex = 0; 
    
    const oldVNode = globalState.containerDOM._currentVNode;
    const newVNode = globalState.rootComponent();
    
    diff(globalState.containerDOM, oldVNode, newVNode, 0);
    globalState.containerDOM._currentVNode = newVNode;

    runEffects();
  });
}

function useState(initialValue) {
  const currentIndex = globalState.hookIndex;
  
  if (globalState.hooks[currentIndex] === undefined) {
    globalState.hooks[currentIndex] = {
      state: initialValue,
      type: 'state'
    };
  }

  const setState = (newValue) => {
    const hook = globalState.hooks[currentIndex];
    const updatedValue = typeof newValue === 'function' ? newValue(hook.state) : newValue;
    
    if (hook.state !== updatedValue) {
      hook.state = updatedValue;
      scheduleRender();
    }
  };

  globalState.hookIndex++;
  return [globalState.hooks[currentIndex].state, setState];
}

function useEffect(effectFn, deps) {
  const currentIndex = globalState.hookIndex;
  const hasNoDeps = !deps;
  const oldHook = globalState.hooks[currentIndex];

  const hasChangedDeps = oldHook
    ? !deps.every((dep, i) => Object.is(dep, oldHook.deps[i]))
    : true;

  if (hasNoDeps || hasChangedDeps) {
    if (globalState.hooks[currentIndex] === undefined) {
      globalState.hooks[currentIndex] = { type: 'effect' };
    }
    
    globalState.hooks[currentIndex].pendingEffect = effectFn;
    globalState.hooks[currentIndex].deps = deps;
  }

  globalState.hookIndex++;
}

function runEffects() {
  globalState.hooks.forEach(hook => {
    if (hook.type === 'effect' && hook.pendingEffect) {
      if (hook.cleanup) {
        try { hook.cleanup(); } catch(e) { console.error(e); }
      }
      hook.cleanup = hook.pendingEffect();
      hook.pendingEffect = null;
    }
  });
}

// ============================================================================
// APPLICATION SUITE: TO-DO IMPLEMENTATION
// ============================================================================
const LOCAL_STORAGE_KEY = 'split_framework_todos';
const loadSavedTodos = () => {
  const saved = localStorage.getItem(LOCAL_STORAGE_KEY);
  return saved ? JSON.parse(saved) : [
    { id: '1', text: 'Build virtual DOM', completed: true },
    { id: '2', text: 'Implement fiber diffing', completed: false },
    { id: '3', text: 'Push to GitHub repository', completed: false }
  ];
};

function TodoApp() {
  const [todos, setTodos] = useState(loadSavedTodos);
  const [inputValue, setInputValue] = useState('');
  const [filter, setFilter] = useState('All');
  const [draggedId, setDraggedId] = useState(null);

  useEffect(() => {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(todos));
  }, [todos]);

  const addTodo = () => {
    if (!inputValue.trim()) return;
    const newTodo = {
      id: Date.now().toString(),
      text: inputValue.trim(),
      completed: false
    };
    setTodos([...todos, newTodo]);
    setInputValue('');
  };

  const toggleTodo = (id) => {
    setTodos(todos.map(t => t.id === id ? { ...t, completed: !t.completed } : t));
  };

  const deleteTodo = (id) => {
    setTodos(todos.filter(t => t.id !== id));
  };

  const clearCompleted = () => {
    setTodos(todos.filter(t => !t.completed));
  };

  const handleDragStart = (id) => {
    setDraggedId(id);
  };

  const handleDragOver = (e, targetId) => {
    e.preventDefault();
    if (draggedId === targetId) return;

    const draggedIndex = todos.findIndex(t => t.id === draggedId);
    const targetIndex = todos.findIndex(t => t.id === targetId);
    
    const updatedTodos = [...todos];
    const [removed] = updatedTodos.splice(draggedIndex, 1);
    updatedTodos.splice(targetIndex, 0, removed);
    
    setTodos(updatedTodos);
  };

  const filteredTodos = todos.filter(t => {
    if (filter === 'Active') return !t.completed;
    if (filter === 'Completed') return t.completed;
    return true;
  });

  const activeCount = todos.filter(t => !t.completed).length;

  return createElement('div', { class: 'container' },
    createElement('h1', null, '📋 My Custom Framework UI'),
    
    createElement('div', { class: 'input-group' },
      createElement('input', {
        type: 'text',
        placeholder: 'What needs to be accomplished?',
        value: inputValue,
        oninput: (e) => setInputValue(e.target.value),
        onkeydown: (e) => { if (e.key === 'Enter') addTodo(); }
      }),
      createElement('button', { onclick: addTodo }, 'Add Task')
    ),

    createElement('div', { class: 'filters' },
      createElement('span', null, `${activeCount} items remaining`),
      createElement('div', { class: 'filter-buttons' },
        ['All', 'Active', 'Completed'].map(type => 
          createElement('button', {
            key: type,
            class: `filter-btn ${filter === type ? 'active' : ''}`,
            onclick: () => setFilter(type)
          }, type)
        )
      ),
      createElement('button', { class: 'clear-btn', onclick: clearCompleted }, 'Clear Completed')
    ),

    createElement('ul', null,
      filteredTodos.map(todo => 
        createElement('li', {
          key: todo.id,
          class: `todo-item ${draggedId === todo.id ? 'dragging' : ''}`,
          draggable: true,
          ondragstart: () => handleDragStart(todo.id),
          ondragover: (e) => handleDragOver(e, todo.id),
          ondragend: () => setDraggedId(null)
        },
          createElement('div', { class: 'todo-left' },
            createElement('input', {
              type: 'checkbox',
              checked: todo.completed,
              onchange: () => toggleTodo(todo.id)
            }),
            createElement('span', {
              class: `todo-text ${todo.completed ? 'completed' : ''}`
            }, todo.text)
          ),
          createElement('button', {
            class: 'delete-btn',
            onclick: () => deleteTodo(todo.id)
          }, 'Delete')
        )
      )
    )
  );
}

// ============================================================================
// SYSTEM KICKSTART / MAIN INITIALIZATION
// ============================================================================
const rootContainer = document.getElementById('root');
globalState.rootComponent = TodoApp;
globalState.containerDOM = rootContainer;

const initialVNode = TodoApp();
render(initialVNode, rootContainer);
runEffects();
