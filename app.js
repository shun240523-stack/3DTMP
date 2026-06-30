// Core Web GL and Interaction variables
let scene, camera, renderer, controls;
let nodes = [];
let connections = [];
let selectedNode = null;
let isDragging = false;
let dragPlane = new THREE.Plane();
let raycaster = new THREE.Raycaster();
let mouse = new THREE.Vector2();
let offset = new THREE.Vector3();
let intersection = new THREE.Vector3();
let highlightBox = null;

// Simulation variables
let simInterval = null;
let simActive = false;
let simCurrentNodeIndex = -1;
let simStartTime = null;
let simTimer = null;
let errorCount = 0;

// Connection Tool variables
let sourceNodeId = null;
let targetNodeId = null;

// Undo/Redo stack
let undoStack = [];
let redoStack = [];

// Colors
const COLORS = {
    start: 0x10b981,     // Emerald
    process: 0x3b82f6,   // Blue
    decision: 0xf59e0b,  // Amber
    loop: 0xa855f7,      // Purple
    io: 0x06b6d4,        // Cyan
    subroutine: 0xf97316, // Orange
    comment: 0xfef08a,   // Yellow
    connection: {
        control: 0xffffff,
        data: 0x22d3ee,
        true: 0x10b981,
        false: 0xef4444,
        event: 0xf59e0b
    }
};

// 1. INITIALIZE THREE.JS SCENE
function init() {
    const container = document.getElementById('canvas-container');
    
    // Scene Setup
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x090a0f);
    
    // Fog for depth feeling
    scene.fog = new THREE.FogExp2(0x090a0f, 0.015);

    // Camera Setup
    camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.1, 1000);
    resetCamera();

    // Renderer
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(renderer.domElement);

    // Controls
    controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.maxPolarAngle = Math.PI / 2 - 0.02; // Don't go below floor
    controls.minDistance = 2;
    controls.maxDistance = 100;
    
    // Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
    scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight.position.set(20, 40, 20);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.width = 2048;
    dirLight.shadow.mapSize.height = 2048;
    scene.add(dirLight);

    // Floor Grid & Axes
    const gridHelper = new THREE.GridHelper(100, 100, 0x1f2937, 0x111827);
    gridHelper.position.y = -8;
    scene.add(gridHelper);

    // Interactive invisible dragging plane
    dragPlane.setFromNormalAndCoplanarPoint(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 0));

    // Selection Highlight Setup
    const outlineGeo = new THREE.BoxGeometry(1.05, 1.05, 1.05);
    const outlineMat = new THREE.MeshBasicMaterial({
        color: 0x60a5fa,
        side: THREE.BackSide,
        transparent: true,
        opacity: 0.8
    });
    highlightBox = new THREE.Mesh(outlineGeo, outlineMat);
    highlightBox.visible = false;
    scene.add(highlightBox);

    // Event Listeners
    window.addEventListener('resize', onWindowResize);
    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    renderer.domElement.addEventListener('pointermove', onPointerMove);
    renderer.domElement.addEventListener('pointerup', onPointerUp);
    renderer.domElement.addEventListener('dblclick', onDoubleClick);

    // Load default flowchart project mirroring image_73d182.jpg
    loadDefaultProject();
    
    // Start rendering cycle
    animate();
    
    addLog("3D Flowchart Studio が正常に初期化されました", "info");
    addLog("デフォルトプロジェクト 'sample_project.f3d' を読み込みました", "success");
}

// 2. HELPER TO CREATE TEXT TEXTURES (Generates beautiful visual nodes)
function createTextTexture(title, desc, type, isSelected = false) {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');

    // Set background base color mapping
    let bgHex = '#1a1d28';
    let accentHex = '#3b82f6';
    if (type === 'start') accentHex = '#10b981';
    if (type === 'decision') accentHex = '#f59e0b';
    if (type === 'loop') accentHex = '#a855f7';
    if (type === 'io') accentHex = '#06b6d4';
    if (type === 'subroutine') accentHex = '#f97316';
    if (type === 'comment') {
        bgHex = '#fef08a';
        accentHex = '#eab308';
    }

    // Draw Background card
    ctx.fillStyle = bgHex;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Draw Left highlight accent bar
    ctx.fillStyle = accentHex;
    ctx.fillRect(0, 0, 20, canvas.height);

    // Draw border
    ctx.strokeStyle = isSelected ? '#3b82f6' : '#2d3142';
    ctx.lineWidth = isSelected ? 12 : 6;
    ctx.strokeRect(0, 0, canvas.width, canvas.height);

    // Title Font Setting
    ctx.fillStyle = (type === 'comment') ? '#1e3a8a' : '#ffffff';
    ctx.font = 'bold 36px "Inter", "Hiragino Kaku Gothic ProN", sans-serif';
    ctx.textAlign = 'left';
    
    // Adjust label text with appropriate type icon representation
    let prefix = "";
    if (type === 'start') prefix = "▶  ";
    if (type === 'decision') prefix = "？ ";
    if (type === 'loop') prefix = "⟲  ";
    
    ctx.fillText(prefix + title, 40, 95);

    // Subtitle / Description text block
    ctx.fillStyle = (type === 'comment') ? '#3b4252' : '#9ca3af';
    ctx.font = '22px "Inter", "Hiragino Kaku Gothic ProN", sans-serif';
    
    // Wrap text if needed
    const descWords = desc || "";
    ctx.fillText(descWords, 40, 160);

    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;
    return texture;
}

// 3. GENERATE 3D NODE OBJECT
function createNodeMesh(data) {
    let geometry;
    const w = data.width || 2.4;
    const h = data.height || 1.2;
    const d = data.depth || 0.3;

    // Tailoring distinct shapes as shown in image_73d182.jpg
    if (data.type === 'start') {
        // Round pill capsule shape
        geometry = new THREE.BoxGeometry(w, h, d); // Simple base, texture details represent visual pill
    } else if (data.type === 'decision') {
        // Diamond shape
        const shape = new THREE.Shape();
        shape.moveTo(0, h/2);
        shape.lineTo(w/2, 0);
        shape.lineTo(0, -h/2);
        shape.lineTo(-w/2, 0);
        shape.lineTo(0, h/2);
        const extrudeSettings = { depth: d, bevelEnabled: true, bevelSegments: 2, steps: 1, bevelSize: 0.03, bevelThickness: 0.03 };
        geometry = new THREE.ExtrudeGeometry(shape, extrudeSettings);
        geometry.center();
    } else if (data.type === 'io') {
        // Parallelogram shape
        const shape = new THREE.Shape();
        shape.moveTo(-w/2 + 0.3, h/2);
        shape.lineTo(w/2, h/2);
        shape.lineTo(w/2 - 0.3, -h/2);
        shape.lineTo(-w/2, -h/2);
        shape.lineTo(-w/2 + 0.3, h/2);
        const extrudeSettings = { depth: d, bevelEnabled: true, bevelSegments: 2, steps: 1, bevelSize: 0.03, bevelThickness: 0.03 };
        geometry = new THREE.ExtrudeGeometry(shape, extrudeSettings);
        geometry.center();
    } else {
        // Processing box
        geometry = new THREE.BoxGeometry(w, h, d);
    }

    // Create Node Textures
    const texture = createTextTexture(data.title, data.desc, data.type, false);
    
    // Build Front and generic face materials
    const frontMaterial = new THREE.MeshStandardMaterial({
        map: texture,
        roughness: 0.2,
        metalness: 0.1
    });

    // Color base for other faces
    let backColorHex = COLORS[data.type] || 0x1f2937;
    const sideMaterial = new THREE.MeshStandardMaterial({
        color: backColorHex,
        roughness: 0.4,
        metalness: 0.3
    });

    // Node multi-material implementation
    let materials;
    if (data.type === 'decision' || data.type === 'io') {
        // Extruded geometries require index mapping
        materials = [frontMaterial, sideMaterial];
    } else {
        // Box Geometry maps [right, left, top, bottom, front, back]
        materials = [
            sideMaterial,  // Right
            sideMaterial,  // Left
            sideMaterial,  // Top
            sideMaterial,  // Bottom
            frontMaterial, // Front (main screen text)
            sideMaterial   // Back
        ];
    }

    const mesh = new THREE.Mesh(geometry, materials);
    mesh.position.set(data.x, data.y, data.z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData = { nodeId: data.id };
    
    return mesh;
}

// 4. DRAW CONNECTION LINES WITH ARROWS
function drawConnection(conn) {
    const source = nodes.find(n => n.id === conn.source);
    const target = nodes.find(n => n.id === conn.target);
    if (!source || !target) return;

    // Remove existing 3D line representation if re-drawing
    if (conn.lineMesh) scene.remove(conn.lineMesh);
    if (conn.arrowMesh) scene.remove(conn.arrowMesh);

    const startPt = new THREE.Vector3(source.x, source.y, source.z);
    const endPt = new THREE.Vector3(target.x, target.y, target.z);

    // Connect using cubic curves to make it look smooth as in references
    const midPt1 = new THREE.Vector3(startPt.x, (startPt.y + endPt.y) / 2, startPt.z);
    const midPt2 = new THREE.Vector3(endPt.x, (startPt.y + endPt.y) / 2, endPt.z);
    
    const curve = new THREE.CatmullRomCurve3([
        startPt,
        midPt1,
        midPt2,
        endPt
    ]);

    const points = curve.getPoints(50);
    const lineGeo = new THREE.BufferGeometry().setFromPoints(points);
    
    const color = COLORS.connection[conn.type] || 0xffffff;
    
    let lineMat;
    if (conn.type === 'control') {
        lineMat = new THREE.LineBasicMaterial({ color: color, linewidth: 2 });
    } else {
        // Dash routing for conditional/data branches
        lineMat = new THREE.LineDashedMaterial({
            color: color,
            dashSize: 0.4,
            gapSize: 0.2,
            linewidth: 1.5
        });
    }

    const line = new THREE.Line(lineGeo, lineMat);
    if (conn.type !== 'control') {
        line.computeLineDistances(); // Mandatory for dashed line to display properly
    }

    scene.add(line);
    conn.lineMesh = line;

    // Draw direction arrow head near target node (cone)
    const arrowGeo = new THREE.ConeGeometry(0.12, 0.3, 8);
    const arrowMat = new THREE.MeshBasicMaterial({ color: color });
    const arrow = new THREE.Mesh(arrowGeo, arrowMat);
    
    // Positioning arrow slightly back from the target surface
    const dir = new THREE.Vector3().subVectors(endPt, midPt2).normalize();
    arrow.position.copy(endPt).sub(dir.clone().multiplyScalar(0.7));
    
    // Rotate cone to face target direction
    arrow.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    scene.add(arrow);
    conn.arrowMesh = arrow;
}

// 5. UPDATE GRAPH CONNECTIONS
function updateAllConnections() {
    connections.forEach(conn => drawConnection(conn));
}

// 6. INITIAL DEMO DATA LOAD (Reflects exactly image_73d182.jpg)
function loadDefaultProject() {
    // Setup demo nodes list
    const initialNodes = [
        { id: 'start_1', title: '開始', desc: 'フローチャートの開始点', type: 'start', x: 0, y: 6, z: 0, width: 2.2, height: 1.0, depth: 0.3 },
        { id: 'init_2', title: '初期化', desc: '変数を初期化する', type: 'process', x: 0, y: 3.8, z: 0, width: 2.3, height: 1.1, depth: 0.3 },
        { id: 'input_3', title: '入力', desc: 'ユーザー入力を取得', type: 'io', x: 4.5, y: 3.8, z: -1.5, width: 2.3, height: 1.1, depth: 0.3 },
        { id: 'decision_4', title: '条件を満たす？', desc: '分岐条件の評価', type: 'decision', x: 0, y: 1.2, z: 0, width: 2.4, height: 1.2, depth: 0.3 },
        { id: 'processA_5', title: '処理A', desc: 'データを処理する', type: 'process', x: -3.5, y: -0.8, z: 1.0, width: 2.2, height: 1.1, depth: 0.3 },
        { id: 'processB_6', title: '処理B', desc: 'エラー処理を行う', type: 'process', x: 3.5, y: -1.2, z: -1.0, width: 2.2, height: 1.1, depth: 0.3 },
        { id: 'loop_7', title: '繰り返し処理', desc: '配列の要素を処理', type: 'loop', x: -3.5, y: -2.8, z: 1.0, width: 2.3, height: 1.1, depth: 0.3 },
        { id: 'sub_8', title: 'ログ記録', desc: 'エラーログを保存', type: 'subroutine', x: 3.5, y: -3.2, z: -1.0, width: 2.3, height: 1.1, depth: 0.3 },
        { id: 'output_9', title: '出力', desc: '結果をコンソールに出力', type: 'io', x: -3.5, y: -4.8, z: 1.0, width: 2.2, height: 1.1, depth: 0.3 },
        { id: 'memo_10', title: 'メモ', desc: 'サンプルフローチャートです', type: 'comment', x: 5.5, y: -5.0, z: -2.0, width: 2.6, height: 1.2, depth: 0.1 },
        { id: 'end_11', title: '終了', desc: '全体のフローを終了', type: 'start', x: 0, y: -6.8, z: 0, width: 2.2, height: 1.0, depth: 0.3 }
    ];

    const initialConnections = [
        { source: 'start_1', target: 'init_2', type: 'control' },
        { source: 'input_3', target: 'init_2', type: 'data' },
        { source: 'init_2', target: 'decision_4', type: 'control' },
        { source: 'decision_4', target: 'processA_5', type: 'true' },
        { source: 'decision_4', target: 'processB_6', type: 'false' },
        { source: 'processA_5', target: 'loop_7', type: 'control' },
        { source: 'loop_7', target: 'output_9', type: 'control' },
        { source: 'processB_6', target: 'sub_8', type: 'control' },
        { source: 'output_9', target: 'end_11', type: 'control' },
        { source: 'sub_8', target: 'end_11', type: 'control' },
        { source: 'memo_10', target: 'sub_8', type: 'event' }
    ];

    // Build Nodes in Three.js
    initialNodes.forEach(n => {
        const mesh = createNodeMesh(n);
        scene.add(mesh);
        n.mesh = mesh;
        nodes.push(n);
    });

    // Set up connections
    connections = initialConnections;
    updateAllConnections();
    
    // Build UI representation state
    updateUIStatus();
    drawMinimap();
}

// 7. USER INTERACTIVE NODE ADDITION
function addNewNode(type) {
    // Generate distinct readable titles based on type
    let title = "処理ノード";
    let desc = "何らかのステップを処理";
    if (type === 'start') { title = "開始/終了"; desc = "実行の節目"; }
    if (type === 'decision') { title = "判定ノード"; desc = "条件分岐します"; }
    if (type === 'loop') { title = "繰り返し処理"; desc = "ループ処理ステップ"; }
    if (type === 'io') { title = "入出力"; desc = "外部情報の入出力"; }
    if (type === 'subroutine') { title = "サブプロセス"; desc = "関連関数呼び出し"; }
    if (type === 'comment') { title = "メモ"; desc = "テキストメモを記入"; }

    // Place in center or slightly offset based on current selection
    let spawnX = 0, spawnY = 0, spawnZ = 0;
    if (selectedNode) {
        spawnX = selectedNode.x + 1.5;
        spawnY = selectedNode.y - 1.5;
        spawnZ = selectedNode.z;
    }

    const uniqueId = type + "_" + Date.now();
    const nodeData = {
        id: uniqueId,
        title: title,
        desc: desc,
        type: type,
        x: spawnX,
        y: spawnY,
        z: spawnZ,
        width: 2.3,
        height: 1.1,
        depth: 0.3
    };

    const mesh = createNodeMesh(nodeData);
    scene.add(mesh);
    nodeData.mesh = mesh;

    nodes.push(nodeData);
    selectNode(nodeData);
    updateAllConnections();
    updateUIStatus();
    drawMinimap();

    addLog(`新しいノード [${title}] が座標(${spawnX}, ${spawnY}, ${spawnZ}) に作成されました。`, "success");
    showToast("ノードを追加しました");
    saveState();
}

// 8. GRAPH HIGHLIGHT & SELECTION HANDLERS
function selectNode(node) {
    selectedNode = node;
    
    if (node) {
        // Focus bounding highlight box
        highlightBox.position.copy(node.mesh.position);
        highlightBox.scale.set(node.width * 1.05, node.height * 1.05, node.depth * 2);
        highlightBox.visible = true;

        // Load Right Property panel values
        document.getElementById('properties-empty').classList.add('hidden');
        document.getElementById('properties-editor').classList.remove('hidden');

        document.getElementById('selected-node-id-badge').innerText = node.id;
        document.getElementById('prop-title').value = node.title;
        document.getElementById('prop-desc').value = node.desc;
        document.getElementById('prop-pos-x').value = node.x.toFixed(1);
        document.getElementById('prop-pos-y').value = node.y.toFixed(1);
        document.getElementById('prop-pos-z').value = node.z.toFixed(1);
        document.getElementById('prop-size-w').value = node.width.toFixed(1);
        document.getElementById('prop-size-h').value = node.height.toFixed(1);
        document.getElementById('prop-size-d').value = node.depth.toFixed(1);
        
        // Select proper icon and labeling
        document.getElementById('prop-node-type-label').innerText = node.type.toUpperCase();

        // If connection helper active, update labels
        updateConnectionStatusMessage();
    } else {
        highlightBox.visible = false;
        document.getElementById('properties-empty').classList.remove('hidden');
        document.getElementById('properties-editor').classList.add('hidden');
        document.getElementById('selected-node-id-badge').innerText = "選択なし";
    }
}

// 9. UPDATE PROPERTIES VIA INPUT BOXES
function updateSelectedNodeProperties() {
    if (!selectedNode) return;

    const t = document.getElementById('prop-title').value;
    const d = document.getElementById('prop-desc').value;
    const px = parseFloat(document.getElementById('prop-pos-x').value) || 0;
    const py = parseFloat(document.getElementById('prop-pos-y').value) || 0;
    const pz = parseFloat(document.getElementById('prop-pos-z').value) || 0;
    const sw = parseFloat(document.getElementById('prop-size-w').value) || 1;
    const sh = parseFloat(document.getElementById('prop-size-h').value) || 1;
    const sd = parseFloat(document.getElementById('prop-size-d').value) || 0.3;

    // Save old state
    selectedNode.title = t;
    selectedNode.desc = d;
    selectedNode.x = px;
    selectedNode.y = py;
    selectedNode.z = pz;
    selectedNode.width = sw;
    selectedNode.height = sh;
    selectedNode.depth = sd;

    // Recreate mesh & texture due to visual parameters change
    scene.remove(selectedNode.mesh);
    const newMesh = createNodeMesh(selectedNode);
    scene.add(newMesh);
    selectedNode.mesh = newMesh;

    // Move Highlight Box
    highlightBox.position.copy(selectedNode.mesh.position);
    highlightBox.scale.set(sw * 1.05, sh * 1.05, sd * 2);

    // Re-draw connections line linking to this node
    updateAllConnections();
    drawMinimap();
}

// 10. CONNECTIONS ROUTING TOOL SETUP
function setConnectionSource() {
    if (!selectedNode) return;
    sourceNodeId = selectedNode.id;
    updateConnectionStatusMessage();
    addLog(`接続元をセットしました: ${selectedNode.title}`, "info");
}

// 11. NODE DELETION LOGIC
function setConnectionTarget() {
    if (!selectedNode) return;
    if (selectedNode.id === sourceNodeId) {
        addLog("エラー: 自身への接続は作成できません。", "error");
        showToast("無効な接続先です");
        return;
    }
    targetNodeId = selectedNode.id;
    updateConnectionStatusMessage();
    addLog(`接続先をセットしました: ${selectedNode.title}`, "info");

    // Open Link build helper options block
    if (sourceNodeId) {
        document.getElementById('link-setup-container').classList.remove('hidden');
    }
}

function updateConnectionStatusMessage() {
    const container = document.getElementById('conn-status-message');
    const srcNode = nodes.find(n => n.id === sourceNodeId);
    const dstNode = nodes.find(n => n.id === targetNodeId);

    let msg = "";
    if (srcNode) msg += `元: <span class="text-blue-400 font-bold">${srcNode.title}</span>`;
    else msg += "元: 未設定";
    
    if (dstNode) msg += ` ➜ 先: <span class="text-emerald-400 font-bold">${dstNode.title}</span>`;
    else msg += " ➜ 先: 未設定";

    container.innerHTML = msg;
}

function createConnection() {
    if (!sourceNodeId || !targetNodeId) return;

    // Read connection line styling parameter
    const type = document.getElementById('link-type-select').value;

    // Check if connection already exists
    const duplicate = connections.find(c => c.source === sourceNodeId && c.target === targetNodeId);
    if (duplicate) {
        addLog("既に同じ接続が存在するため作成をスキップしました。", "error");
        showToast("接続は既に存在します");
        return;
    }

    const newConn = { source: sourceNodeId, target: targetNodeId, type: type };
    connections.push(newConn);
    
    // Render 3D line representation immediately
    drawConnection(newConn);
    updateUIStatus();

    // Clear connection tool buffer
    sourceNodeId = null;
    targetNodeId = null;
    document.getElementById('link-setup-container').classList.add('hidden');
    updateConnectionStatusMessage();
    
    addLog("ノード間に新しいパスを接続しました。", "success");
    showToast("接続を作成しました");
    saveState();
}

function deleteSelectedNode() {
    if (!selectedNode) return;

    const nId = selectedNode.id;
    addLog(`ノード ${selectedNode.title} (${nId}) を削除中...`, "info");

    // Remove associated 3D connections rendering objects
    const remainingConnections = [];
    connections.forEach(conn => {
        if (conn.source === nId || conn.target === nId) {
            if (conn.lineMesh) scene.remove(conn.lineMesh);
            if (conn.arrowMesh) scene.remove(conn.arrowMesh);
        } else {
            remainingConnections.push(conn);
        }
    });
    connections = remainingConnections;

    // Remove mesh model and clean from memory
    scene.remove(selectedNode.mesh);
    nodes = nodes.filter(n => n.id !== nId);
    
    // Clean selection focus
    selectNode(null);
    updateUIStatus();
    drawMinimap();
    
    showToast("ノードを削除しました");
    saveState();
}

// 12. THREE.JS CONTROLS INTERACTION HELPERS
function onPointerDown(event) {
    // Get screen cursor values
    const rect = renderer.domElement.getBoundingClientRect();
    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObjects(nodes.map(n => n.mesh));

    if (intersects.length > 0) {
        const hitMesh = intersects[0].object;
        const node = nodes.find(n => n.id === hitMesh.userData.nodeId);
        
        // Select node representation
        selectNode(node);
        
        // Disable Orbit camera orbit controls during item sliding movement
        controls.enabled = false;
        isDragging = true;

        // Drag positioning projection calculation
        if (raycaster.ray.intersectPlane(dragPlane, intersection)) {
            offset.copy(intersection).sub(hitMesh.position);
        }
    }
}

function onPointerMove(event) {
    const rect = renderer.domElement.getBoundingClientRect();
    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    if (isDragging && selectedNode) {
        raycaster.setFromCamera(mouse, camera);
        if (raycaster.ray.intersectPlane(dragPlane, intersection)) {
            const nextPos = intersection.clone().sub(offset);
            
            // Drag smooth step updates
            selectedNode.x = Math.round(nextPos.x * 2) / 2; // Snapping steps
            selectedNode.z = Math.round(nextPos.z * 2) / 2;
            // Y axis is vertical, modified via side parameters only while dragging X-Z plane

            // Sync visual mesh translation
            selectedNode.mesh.position.set(selectedNode.x, selectedNode.y, selectedNode.z);
            highlightBox.position.copy(selectedNode.mesh.position);

            // Sync Properties numeric indicators
            document.getElementById('prop-pos-x').value = selectedNode.x.toFixed(1);
            document.getElementById('prop-pos-z').value = selectedNode.z.toFixed(1);

            // Recalculate 3D link wireframe lines position
            updateAllConnections();
        }
    }
}

function onPointerUp() {
    if (isDragging) {
        controls.enabled = true;
        isDragging = false;
        drawMinimap();
        saveState();
    }
    
    // Write camera coordinates into footer diagnostics status
    updateFooterDiagnostics();
}

function onDoubleClick(event) {
    // Standardizing trigger behavior for zoom and view selection
}

function onWindowResize() {
    const container = document.getElementById('canvas-container');
    camera.aspect = container.clientWidth / container.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(container.clientWidth, container.clientHeight);
    drawMinimap();
}

function resetCamera() {
    camera.position.set(12, 8.5, 14);
    if (controls) {
        controls.target.set(0, 0, 0);
        controls.update();
    }
    updateFooterDiagnostics();
}

function updateFooterDiagnostics() {
    if (!camera) return;
    const posText = `カメラ位置: X: ${camera.position.x.toFixed(1)} Y: ${camera.position.y.toFixed(1)} Z: ${camera.position.z.toFixed(1)}`;
    document.getElementById('status-camera-pos').innerText = posText;
}

// 13. FLOWCHART INTERACTIVE SIMULATOR (Executes node paths step-by-step)
function startSimulation() {
    if (simActive) return;

    addLog("シミュレーション実行中...", "info");
    simActive = true;
    simStartTime = Date.now();
    
    // Adjust header button styles immediately
    document.getElementById('btn-run').classList.add('opacity-50', 'pointer-events-none');
    document.getElementById('btn-stop').classList.remove('opacity-50', 'cursor-not-allowed');
    document.getElementById('btn-stop').disabled = false;
    document.getElementById('sim-run-btn').classList.add('bg-blue-800', 'pointer-events-none');
    document.getElementById('sim-status-label').innerText = "実行中";
    document.getElementById('sim-status-label').classList.replace('text-gray-400', 'text-emerald-400');

    // Find start node (emerald colored "start" type)
    const startNode = nodes.find(n => n.type === 'start' && n.id.includes('start'));
    if (!startNode) {
        addLog("シミュレーションエラー: '開始' ノードが見つかりません。", "error");
        stopSimulation();
        return;
    }

    // Highlighting step index sequence
    simCurrentNodeIndex = nodes.indexOf(startNode);
    highlightSimulatingNode(startNode);

    // Periodical runner simulation interval
    simInterval = setInterval(() => {
        stepSimulationLogic();
    }, 1500);

    // Timer display update loop
    simTimer = setInterval(() => {
        const elapsedSec = Math.floor((Date.now() - simStartTime) / 1000);
        const hrs = String(Math.floor(elapsedSec / 3600)).padStart(2, '0');
        const mins = String(Math.floor((elapsedSec % 3600) / 60)).padStart(2, '0');
        const secs = String(elapsedSec % 60).padStart(2, '0');
        document.getElementById('sim-time-label').innerText = `${hrs}:${mins}:${secs}`;
    }, 1000);
}

function stepSimulation() {
    // Manual flow step trigger execution helper
    if (!simActive) {
        startSimulation();
        setTimeout(() => {
            clearInterval(simInterval); // Freeze intervals, let user hit step manually
        }, 100);
    } else {
        clearInterval(simInterval);
        stepSimulationLogic();
    }
}

// 14. SIMULATION PATH TREE RESOLVING ALGORITHM
function stepSimulationLogic() {
    if (simCurrentNodeIndex === -1) return;

    const currentNode = nodes[simCurrentNodeIndex];
    addLog(`[ステップ実行] Node "${currentNode.title}" (タイプ: ${currentNode.type}) 完了。次の工程を探索中...`, "info");
    
    // Find connections originating from the current active node
    const outgoing = connections.filter(c => c.source === currentNode.id);

    if (outgoing.length === 0) {
        // Terminating node reached
        addLog(`シミュレーションプロセス終了: 終端ノード "${currentNode.title}" に達しました。`, "success");
        stopSimulation();
        return;
    }

    // Decide path selection logic based on Node Types
    let nextTargetId = null;

    if (currentNode.type === 'decision') {
        // Decision branching logic (Choose True or False branch randomly for simulation representation)
        const trueBranch = outgoing.find(c => c.type === 'true');
        const falseBranch = outgoing.find(c => c.type === 'false');

        const choice = Math.random() > 0.4 ? 'true' : 'false';
        const selectedBranch = choice === 'true' ? trueBranch : falseBranch;

        if (selectedBranch) {
            nextTargetId = selectedBranch.target;
            addLog(`分岐決定: 判定ノードにより [${choice.toUpperCase()}] 分岐に推移しました。`, "info");
        } else {
            nextTargetId = outgoing[0].target; // Default fallback connection route
        }
    } else {
        // Standard single pipeline path route transition
        const controlFlow = outgoing.find(c => c.type === 'control');
        if (controlFlow) {
            nextTargetId = controlFlow.target;
        } else {
            nextTargetId = outgoing[0].target; // Select primary out edge
        }
    }

    const nextNode = nodes.find(n => n.id === nextTargetId);
    if (nextNode) {
        simCurrentNodeIndex = nodes.indexOf(nextNode);
        highlightSimulatingNode(nextNode);
    } else {
        addLog("シミュレーションエラー: 次の遷移先ノードが見つかりません。", "error");
        stopSimulation();
    }
}

function highlightSimulatingNode(node) {
    // Update panel text
    document.getElementById('sim-current-node-label').innerText = node.title;

    // Simple visual mesh glowing effect using emissive parameters on multi-material faces
    nodes.forEach(n => {
        if (n.mesh) {
            // Reset all other materials
            n.mesh.material.forEach(mat => {
                if (mat.emissive) mat.emissive.setHex(0x000000);
            });
        }
    });

    // Glowing green color visual indicating execution trace
    if (node.mesh) {
        node.mesh.material.forEach(mat => {
            if (mat.emissive) mat.emissive.setHex(0x22c55e); // Soft Emerald Emissive glow
        });
    }

    // Add step diagnostic entry block into right side short status box
    const loggerBox = document.getElementById('sim-short-log');
    const timeStr = new Date().toLocaleTimeString();
    loggerBox.innerHTML += `<div class="text-emerald-400 font-semibold">[${timeStr}] Active: ${node.title}</div>`;
    loggerBox.scrollTop = loggerBox.scrollHeight;
}

function stopSimulation() {
    if (!simActive) return;

    addLog("シミュレーションを停止しました。", "info");
    simActive = false;
    clearInterval(simInterval);
    clearInterval(simTimer);

    // Restore header indicators colors
    document.getElementById('btn-run').classList.remove('opacity-50', 'pointer-events-none');
    document.getElementById('btn-stop').classList.add('opacity-50', 'cursor-not-allowed');
    document.getElementById('btn-stop').disabled = true;
    document.getElementById('sim-run-btn').classList.remove('bg-blue-800', 'pointer-events-none');
    document.getElementById('sim-status-label').innerText = "停止中";
    document.getElementById('sim-status-label').classList.replace('text-emerald-400', 'text-gray-400');
    document.getElementById('sim-current-node-label').innerText = "-";

    // Clean mesh emitting highlights
    nodes.forEach(n => {
        if (n.mesh) {
            n.mesh.material.forEach(mat => {
                if (mat.emissive) mat.emissive.setHex(0x000000);
            });
        }
    });
}

// 14. GRAPH DIAGNOSTICS LOGGING PANELS
function addLog(message, type = 'info') {
    const container = document.getElementById('footer-tab-content');
    const timestamp = new Date().toLocaleTimeString();
    
    let colorClass = "text-gray-400";
    let prefix = "[INFO]";
    if (type === 'success') { colorClass = "text-emerald-400"; prefix = "[SUCCESS]"; }
    if (type === 'error') { 
        colorClass = "text-rose-400 font-semibold"; 
        prefix = "[ERROR]"; 
        errorCount++;
        document.getElementById('error-count-badge').innerText = errorCount;
    }

    const item = document.createElement('div');
    item.className = `${colorClass} flex space-x-2`;
    item.innerHTML = `<span>[${timestamp}]</span> <span>${prefix}</span> <span>${message}</span>`;
    
    container.appendChild(item);
    container.scrollTop = container.scrollHeight;
}

function changeFooterTab(tab) {
    // Update tabs highlight
    document.getElementById('tab-btn-log').className = `px-3 py-2 border-b-2 text-xs flex items-center space-x-1.5 ${tab === 'log' ? 'border-blue-500 text-white' : 'border-transparent text-gray-500 hover:text-gray-300'}`;
    document.getElementById('tab-btn-error').className = `px-3 py-2 border-b-2 text-xs flex items-center space-x-1.5 ${tab === 'error' ? 'border-blue-500 text-white' : 'border-transparent text-gray-500 hover:text-gray-300'}`;
    document.getElementById('tab-btn-search').className = `px-3 py-2 border-b-2 text-xs flex items-center space-x-1.5 ${tab === 'search' ? 'border-blue-500 text-white' : 'border-transparent text-gray-500 hover:text-gray-300'}`;

    const container = document.getElementById('footer-tab-content');
    if (tab === 'log') {
        container.innerHTML = "";
        addLog("ログコンソールへ切り替えました", "info");
    } else if (tab === 'error') {
        container.innerHTML = `<div class="text-rose-400 italic font-medium">// ${errorCount}件のエラーが検出されています。</div>`;
    } else if (tab === 'search') {
        container.innerHTML = `
            <div class="flex items-center space-x-2 bg-[#0c0d12] p-2 rounded max-w-md border border-[#2d3142]">
                <i class="fa-solid fa-magnifying-glass text-gray-500"></i>
                <input type="text" placeholder="ノード名またはIDで検索..." oninput="filterSearchNodes(this.value)" class="bg-transparent focus:outline-none text-xs text-white w-full">
            </div>
            <div id="search-results-list" class="mt-2 space-y-1"></div>
        `;
    }
}

function filterSearchNodes(query) {
    const resultsBox = document.getElementById('search-results-list');
    if (!resultsBox) return;
    resultsBox.innerHTML = "";

    if (!query) return;

    const matches = nodes.filter(n => n.title.toLowerCase().includes(query.toLowerCase()) || n.id.includes(query));
    matches.forEach(m => {
        const item = document.createElement('div');
        item.className = "p-1.5 bg-[#14161f] hover:bg-[#222533] rounded cursor-pointer text-xs flex justify-between";
        item.onclick = () => { selectNode(m); camera.position.set(m.x + 4, m.y + 4, m.z + 8); controls.target.set(m.x, m.y, m.z); };
        item.innerHTML = `<span>${m.title}</span> <span class="text-[10px] text-gray-500 font-mono">${m.id}</span>`;
        resultsBox.appendChild(item);
    });
}

// 15. CANVAS 2D MINIMAP RENDERING
function drawMinimap() {
    const canvas = document.getElementById('minimap-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    
    // Adjust resolution dynamically to container size
    canvas.width = canvas.parentElement.clientWidth;
    canvas.height = canvas.parentElement.clientHeight;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (nodes.length === 0) return;

    // Find nodes coordinates boundaries limit map projection
    let minX = -10, maxX = 10, minY = -10, maxY = 10;
    nodes.forEach(n => {
        if (n.x < minX) minX = n.x - 2;
        if (n.x > maxX) maxX = n.x + 2;
        if (n.y < minY) minY = n.y - 2;
        if (n.y > maxY) maxY = n.y + 2;
    });

    const scaleX = canvas.width / (maxX - minX);
    const scaleY = canvas.height / (maxY - minY);
    const scale = Math.min(scaleX, scaleY) * 0.8;

    const mapOffsetX = canvas.width / 2 - (maxX + minX) / 2 * scale;
    const mapOffsetY = canvas.height / 2 - (maxY + minY) / 2 * scale;

    // Draw link connections map representation
    connections.forEach(conn => {
        const src = nodes.find(n => n.id === conn.source);
        const dst = nodes.find(n => n.id === conn.target);
        if (src && dst) {
            ctx.strokeStyle = conn.type === 'control' ? '#ffffff' : '#38bdf8';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(src.x * scale + mapOffsetX, -src.y * scale + mapOffsetY);
            ctx.lineTo(dst.x * scale + mapOffsetX, -dst.y * scale + mapOffsetY);
            ctx.stroke();
        }
    });

    // Draw nodes boxes map representation
    nodes.forEach(n => {
        let color = "#3b82f6";
        if (n.type === 'start') color = "#10b981";
        if (n.type === 'decision') color = "#f59e0b";
        if (n.type === 'loop') color = "#a855f7";

        ctx.fillStyle = color;
        const px = n.x * scale + mapOffsetX - 4;
        const py = -n.y * scale + mapOffsetY - 3;
        
        ctx.fillRect(px, py, 8, 6);
        
        // Highlight Selected Node indicator
        if (selectedNode && selectedNode.id === n.id) {
            ctx.strokeStyle = "#ffffff";
            ctx.lineWidth = 1.5;
            ctx.strokeRect(px - 2, py - 2, 12, 10);
        }
    });
}

// 16. UI DIAGNOSTICS AND FILE EXPORTS
function updateUIStatus() {
    document.getElementById('status-nodes-count').innerText = `ノード数: ${nodes.length}`;
    document.getElementById('status-connections-count').innerText = connections.length;
}

function createNewProject() {
    if (confirm("現在のフローチャートをクリアして新しいプロジェクトを開始しますか？")) {
        stopSimulation();
        
        // Remove all mesh references
        nodes.forEach(n => scene.remove(n.mesh));
        connections.forEach(c => {
            if (c.lineMesh) scene.remove(c.lineMesh);
            if (c.arrowMesh) scene.remove(c.arrowMesh);
        });

        nodes = [];
        connections = [];
        selectNode(null);
        
        updateAllConnections();
        updateUIStatus();
        drawMinimap();
        
        addLog("プロジェクトを新規作成しました。", "info");
        showToast("新規作成完了");
        saveState();
    }
}

function triggerFileLoad() {
    document.getElementById('file-loader').click();
}

function loadProjectFile(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const project = JSON.parse(e.target.result);
            
            // Clear existing assets
            nodes.forEach(n => scene.remove(n.mesh));
            connections.forEach(c => {
                if (c.lineMesh) scene.remove(c.lineMesh);
                if (c.arrowMesh) scene.remove(c.arrowMesh);
            });

            nodes = [];
            connections = [];

            // Render new elements
            project.nodes.forEach(n => {
                const mesh = createNodeMesh(n);
                scene.add(mesh);
                n.mesh = mesh;
                nodes.push(n);
            });

            connections = project.connections;
            updateAllConnections();
            updateUIStatus();
            drawMinimap();
            selectNode(null);

            addLog(`プロジェクト "${file.name}" をインポートしました。`, "success");
            showToast("インポートしました");
            saveState();
        } catch(err) {
            addLog("プロジェクトファイルのパースに失敗しました。", "error");
        }
    };
    reader.readAsText(file);
}

function saveProject() {
    // Simplified Local Storage saving trigger
    const data = serializeGraph();
    localStorage.setItem('3d_flowchart_project', JSON.stringify(data));
    addLog("プロジェクトをローカルストレージへ自動保存しました。", "success");
    showToast("保存完了 (Local)");
}

function exportJSON() {
    const data = serializeGraph();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'sample_project.f3d';
    a.click();
    URL.revokeObjectURL(url);
    addLog("プロジェクトをエクスポートしました (sample_project.f3d)", "success");
}

function serializeGraph() {
    // Export structure without cyclic Three.js Mesh pointers
    const exportedNodes = nodes.map(n => ({
        id: n.id,
        title: n.title,
        desc: n.desc,
        type: n.type,
        x: n.x,
        y: n.y,
        z: n.z,
        width: n.width,
        height: n.height,
        depth: n.depth
    }));

    const exportedConnections = connections.map(c => ({
        source: c.source,
        target: c.target,
        type: c.type
    }));

    return {
        nodes: exportedNodes,
        connections: exportedConnections
    };
}

// 17. UNDO / REDO STATE MACHINE
function saveState() {
    const serialized = serializeGraph();
    undoStack.push(JSON.stringify(serialized));
    redoStack = []; // Clean redo history upon new actions
}

function undo() {
    if (undoStack.length <= 1) {
        showToast("戻せる履歴がありません");
        return;
    }

    const current = undoStack.pop();
    redoStack.push(current);

    const previous = undoStack[undoStack.length - 1];
    applyStateString(previous);
    addLog("操作を一つ取り消しました (Undo)", "info");
}

function redo() {
    if (redoStack.length === 0) {
        showToast("進める履歴がありません");
        return;
    }

    const next = redoStack.pop();
    undoStack.push(next);
    applyStateString(next);
    addLog("操作をやり直しました (Redo)", "info");
}

function applyStateString(stateStr) {
    const project = JSON.parse(stateStr);
    
    // Wipe existing representation models
    nodes.forEach(n => scene.remove(n.mesh));
    connections.forEach(c => {
        if (c.lineMesh) scene.remove(c.lineMesh);
        if (c.arrowMesh) scene.remove(c.arrowMesh);
    });

    nodes = [];
    connections = [];

    // Regenerate
    project.nodes.forEach(n => {
        const mesh = createNodeMesh(n);
        scene.add(mesh);
        n.mesh = mesh;
        nodes.push(n);
    });

    connections = project.connections;
    updateAllConnections();
    updateUIStatus();
    drawMinimap();
    selectNode(null);
}

// 18. NOTIFICATIONS & MODALS
function showToast(text) {
    const t = document.getElementById('toast');
    document.getElementById('toast-text').innerText = text;
    t.classList.replace('opacity-0', 'opacity-100');
    t.classList.replace('translate-y-2', 'translate-y-0');

    setTimeout(() => {
        t.classList.replace('opacity-100', 'opacity-0');
        t.classList.replace('translate-y-0', 'translate-y-2');
    }, 2500);
}

function adjustViewScale(multiplier) {
    camera.position.multiplyScalar(multiplier);
    controls.update();
    updateFooterDiagnostics();
}

function toggleSettings() {
    alert("「設定」機能: ダークテーマのカスタムカラーパレット構成、グリッド不透明度の調整、シミュレーション速度などのオプションが含まれます。");
}

function showHelp() {
    alert("【3D Flowchart Studio ヘルプ】\n\n1. 左側の「ノード追加」をクリックすると、3D空間に新規ノードが配置されます。\n2. ノードをドラッグすると、X-Zグリッド平面を滑らかに移動できます。\n3. 右側のプロパティパネルで、選択中ノードの文言やサイズ、座標をいつでも微調整できます。\n4. 「接続元」と「接続先」を選択して【接続を作成】を押すと、ノード間を繋ぐ実線・破線が生成されます。\n5. 右上の「実行」ボタンで、開始ノードから処理経路を自動巡回するシミュレーターが動きます。\n6. Ctrl+Z/Ctrl+Y、エクスポート(保存)に対応しています。");
}

// 19. RENDER GAME LOOP AND INITIAL WINDOW EVENT
function animate() {
    requestAnimationFrame(animate);
    
    // OrbitControls update
    if (controls) controls.update();
    
    // Redraw Grid
    renderer.render(scene, camera);
}

window.onload = function() {
    // Initiate core app systems
    init();

    // Push starting state into Undo stack history
    const initial = serializeGraph();
    undoStack.push(JSON.stringify(initial));

    // Hotkey actions listeners
    window.addEventListener('keydown', (e) => {
        if (e.ctrlKey && e.key === 'z') { e.preventDefault(); undo(); }
        if (e.ctrlKey && e.key === 'y') { e.preventDefault(); redo(); }
    });
};