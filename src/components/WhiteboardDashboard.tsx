import { useEffect, useRef, useState } from 'react';
import * as fabric from 'fabric';

interface DashboardProps {
  logout: () => void;
}

interface RemoteCursor {
  user_id: string;
  cursor_x: number;
  cursor_y: number;
  canvas_json?: string;
}

const LOCAL_USER_ID = 'user_' + Math.random().toString(36).substring(2, 7);
const API_BASE_URL = 'http://localhost:3000/api/whiteboard'; 

export default function WhiteboardDashboard({ logout }: DashboardProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fabricCanvasRef = useRef<fabric.Canvas | null>(null);
  
  const isRedoingUndoingRef = useRef<boolean>(false);
  const historyIndexRef = useRef<number>(0);
  const historyRef = useRef<string[]>(['{"version":"5.3.0","objects":[]}']);

  const [brushColor, setBrushColor] = useState<string>('#000000');
  const [brushSize, setBrushSize] = useState<number>(5);
  
  const [canUndo, setCanUndo] = useState<boolean>(false);
  const [canRedo, setCanRedo] = useState<boolean>(false);
  const [remoteCursors, setRemoteCursors] = useState<RemoteCursor[]>([]);

  useEffect(() => {
    if (!canvasRef.current) return;

    let isMounted = true;

    if (fabricCanvasRef.current) {
      try {
        fabricCanvasRef.current.dispose();
      } catch (e) {
        console.warn("Cleanup deferred safely:", e);
      }
      fabricCanvasRef.current = null;
    }

    const canvas = new fabric.Canvas(canvasRef.current, {
      isDrawingMode: true,
      backgroundColor: '#ffffff',
      selection: false,
      width: 750,
      height: 500
    });
    fabricCanvasRef.current = canvas;

    const pencilBrush = new fabric.PencilBrush(canvas);
    pencilBrush.color = brushColor;
    pencilBrush.width = brushSize;
    canvas.freeDrawingBrush = pencilBrush;

    const syncCanvasToDatabase = async () => {
      if (!canvas || !isMounted || isRedoingUndoingRef.current) return;

      try {
        const jsonString = JSON.stringify(canvas.toJSON());
        
        const updatedHistory = historyRef.current.slice(0, historyIndexRef.current + 1);
        updatedHistory.push(jsonString);
        
        historyRef.current = updatedHistory;
        historyIndexRef.current = updatedHistory.length - 1;

        setCanUndo(historyIndexRef.current > 0);
        setCanRedo(false);

        await fetch(`${API_BASE_URL}/update-canvas`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ user_id: LOCAL_USER_ID, canvas_json: jsonString })
        });
      } catch (err) {
        console.warn("Database save pipeline deferred:", err);
      }
    };

    canvas.on('object:added', syncCanvasToDatabase);
    canvas.on('object:modified', syncCanvasToDatabase);

    const handleMouseMove = async (options: fabric.IEvent) => {
      if (options.pointer) {
        try {
          await fetch(`${API_BASE_URL}/move-cursor`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              user_id: LOCAL_USER_ID,
              x: options.pointer.x,
              y: options.pointer.y
            })
          });
        } catch (e) {
          
        }
      }
    };
    canvas.on('mouse:move', handleMouseMove);

    const pollInterval = setInterval(async () => {
      if (!isMounted || isRedoingUndoingRef.current) return;
      try {
        const response = await fetch(`${API_BASE_URL}/stream-room?exclude=${LOCAL_USER_ID}`);
        if (!response.ok) return;
        
        const data: RemoteCursor[] = await response.json();
        setRemoteCursors(data);

        const primaryPartner = data.find(user => user.canvas_json);
        if (primaryPartner && primaryPartner.canvas_json) {
          const currentCanvasState = JSON.stringify(canvas.toJSON());
          if (primaryPartner.canvas_json !== currentCanvasState) {
            isRedoingUndoingRef.current = true;
            canvas.loadFromJSON(primaryPartner.canvas_json, () => {
              canvas.renderAll();
              isRedoingUndoingRef.current = false;
            });
          }
        }
      } catch (err) {
        console.error("Database sync paused:", err);
      }
    }, 150);

    requestAnimationFrame(() => {
      if (canvas && (canvas as any).upperCanvasEl) {
        canvas.calcOffset();
        canvas.renderAll();
      }
    });

    return () => {
      isMounted = false;
      clearInterval(pollInterval);
      canvas.off('object:added', syncCanvasToDatabase);
      canvas.off('object:modified', syncCanvasToDatabase);
      canvas.off('mouse:move', handleMouseMove);
      canvas.dispose();
      fabricCanvasRef.current = null;
    };
  }, []);

  useEffect(() => {
    const canvas = fabricCanvasRef.current;
    if (canvas && canvas.freeDrawingBrush) {
      canvas.freeDrawingBrush.color = brushColor;
      canvas.freeDrawingBrush.width = brushSize;
      canvas.renderAll();
    }
  }, [brushColor, brushSize]);

  const handleUndo = async () => {
    if (historyIndexRef.current > 0 && fabricCanvasRef.current) {
      historyIndexRef.current -= 1;
      const targetState = historyRef.current[historyIndexRef.current];
      
      isRedoingUndoingRef.current = true;
      setCanUndo(historyIndexRef.current > 0);
      setCanRedo(true);

      fabricCanvasRef.current.loadFromJSON(targetState, async () => {
        fabricCanvasRef.current?.renderAll();
        isRedoingUndoingRef.current = false;

        try {
          await fetch(`${API_BASE_URL}/update-canvas`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user_id: LOCAL_USER_ID, canvas_json: targetState })
          });
        } catch (e) {
          console.warn("Could not sync undo step:", e);
        }
      });
    }
  };

  const handleRedo = async () => {
    if (historyIndexRef.current < historyRef.current.length - 1 && fabricCanvasRef.current) {
      historyIndexRef.current += 1;
      const targetState = historyRef.current[historyIndexRef.current];

      isRedoingUndoingRef.current = true;
      setCanUndo(true);
      setCanRedo(historyIndexRef.current < historyRef.current.length - 1);

      fabricCanvasRef.current.loadFromJSON(targetState, async () => {
        fabricCanvasRef.current?.renderAll();
        isRedoingUndoingRef.current = false;

        try {
          await fetch(`${API_BASE_URL}/update-canvas`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user_id: LOCAL_USER_ID, canvas_json: targetState })
          });
        } catch (e) {
          console.warn("Could not sync redo step:", e);
        }
      });
    }
  };

  const exportCanvasImage = (format: 'png' | 'jpeg') => {
    const canvasInstance = fabricCanvasRef.current;
    if (!canvasInstance) return;

    canvasInstance.renderAll();
    const dataUrl = canvasInstance.toDataURL({
      format: format,
      quality: 1.0,
    });

    const downloadAnchor = document.createElement('a');
    downloadAnchor.href = dataUrl;
    downloadAnchor.download = `whiteboard-capture.${format}`;
    
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    document.body.removeChild(downloadAnchor);
  };

  return (
    <div className="container-fluid py-4 bg-light min-vh-100 position-relative">
      <header className="d-flex justify-content-between align-items-center mb-4 pb-2 border-bottom bg-white p-3 rounded shadow-sm">
        <h2 className="h4 text-dark fw-bold mb-0">CollabBoard Workspace</h2>
        <button onClick={logout} className="btn btn-outline-danger btn-sm px-4">Log Out</button>
      </header>

      <div className="row g-4">
        {/* Controls Panel Layout */}
        <div className="col-12 col-md-4 col-lg-3">
          <div className="card shadow-sm border-0 p-3 bg-white">
            <h5 className="card-title mb-3 border-bottom pb-2 fw-bold text-secondary">Brush Tool</h5>
            
            <div className="mb-3">
              <label className="form-label small fw-semibold text-muted">Color</label>
              <input 
                type="color" 
                className="form-control form-control-color w-100 rounded" 
                value={brushColor} 
                onChange={(e) => setBrushColor(e.target.value)} 
              />
            </div>

            <div className="mb-4">
              <label className="form-label small fw-semibold text-muted">Size: {brushSize}px</label>
              <input 
                type="range" 
                className="form-range" 
                min="1" 
                max="30" 
                value={brushSize} 
                onChange={(e) => setBrushSize(parseInt(e.target.value))} 
              />
            </div>

            <h5 className="card-title mb-3 border-bottom pb-2 fw-bold text-secondary">Timeline Actions</h5>
            <div className="btn-group w-100 mb-4">
              <button onClick={handleUndo} disabled={!canUndo} className="btn btn-outline-primary btn-sm py-2">
                Undo
              </button>
              <button onClick={handleRedo} disabled={!canRedo} className="btn btn-outline-primary btn-sm py-2">
                Redo
              </button>
            </div>

            <h5 className="card-title mb-3 border-bottom pb-2 fw-bold text-secondary">Export Board</h5>
            <div className="d-grid gap-2">
              <button onClick={() => exportCanvasImage('png')} className="btn btn-primary btn-sm fw-semibold py-2">
                Download as PNG
              </button>
              <button onClick={() => exportCanvasImage('jpeg')} className="btn btn-outline-dark btn-sm fw-semibold py-2">
                Download as JPEG
              </button>
            </div>
          </div>
        </div>

        {/* Workspace Display Layout */}
        <div className="col-12 col-md-8 col-lg-9 d-flex justify-content-start align-items-start">
          <div 
            className="bg-white border rounded shadow-sm p-2 position-relative" 
            style={{ width: '770px', height: '520px', overflow: 'hidden' }}
          >
            <canvas ref={canvasRef} />

            {/* Floating Collaborative Cursors Tracker */}
            {remoteCursors.map((user) => (
              <div
                key={user.user_id}
                style={{
                  position: 'absolute',
                  left: `${Number(user.cursor_x) + 8}px`,
                  top: `${Number(user.cursor_y) + 8}px`,
                  pointerEvents: 'none',
                  zIndex: 1000,
                  transition: 'all 0.1s linear'
                }}
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path d="M0 0V11L3.5 8.5L7 14L9 13L5.5 7.5L10 7L0 0Z" fill="#2196f3"/>
                </svg>
                <span className="badge bg-primary small ms-1 py-1">
                  {user.user_id}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}