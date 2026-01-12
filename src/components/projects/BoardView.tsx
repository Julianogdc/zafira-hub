import { useState } from "react";
import { AsanaTask, AsanaSection } from "@/types/asana";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { CalendarClock, CheckCircle2, User as UserIcon, Plus } from "lucide-react";
import { formatTaskDate, getColorClass } from "@/lib/asana-helpers";
import { DragDropContext, Droppable, Draggable, DropResult } from "@hello-pangea/dnd";
import { Button } from "@/components/ui/button";

interface BoardViewProps {
    sections: AsanaSection[];
    tasks: AsanaTask[];
    onTaskClick: (task: AsanaTask) => void;
    onTaskMove: (taskGid: string, newSectionGid: string) => void;
    onNewTask?: (sectionGid: string) => void;
}

export const BoardView = ({ sections, tasks, onTaskClick, onTaskMove, onNewTask }: BoardViewProps) => {

    // Group tasks by section
    const getTasksBySection = (sectionGid: string) => {
        return tasks.filter(t =>
            t.memberships?.some(m => m.section?.gid === sectionGid)
        );
    };

    // Handle drag end
    const onDragEnd = (result: DropResult) => {
        const { destination, source, draggableId } = result;

        // Dropped outside or same position
        if (!destination) return;
        if (destination.droppableId === source.droppableId && destination.index === source.index) return;

        // If defined callback
        onTaskMove(draggableId, destination.droppableId);
    };

    // Identify tasks with NO section (catch-all)
    const unsortedTasks = tasks.filter(t => !t.memberships?.some(m => sections.some(s => s.gid === m.section?.gid)));

    return (
        <DragDropContext onDragEnd={onDragEnd}>
            <div className="flex h-full gap-6 overflow-x-auto pb-4 items-start relative">

                {/* UNSORTED COLUMN (If any tasks found) */}
                {unsortedTasks.length > 0 && (
                    <div className="w-80 shrink-0 flex flex-col max-h-full">
                        <div className="flex items-center justify-between mb-4 px-1">
                            <div className="flex items-center gap-2">
                                <h3 className="font-bold text-slate-400 text-sm uppercase tracking-wider">Sem Seção</h3>
                                <Badge variant="secondary" className="bg-slate-800 text-slate-400 border-none hover:bg-slate-800 w-5 h-5 flex items-center justify-center p-0 text-[10px]">{unsortedTasks.length}</Badge>
                            </div>
                        </div>
                        <Droppable droppableId="unsorted">
                            {(provided) => (
                                <div {...provided.droppableProps} ref={provided.innerRef} className="bg-white/5 rounded-xl p-2 border border-white/5 min-h-[150px] flex-1">
                                    {unsortedTasks.map((task, index) => (
                                        <TaskCard key={task.gid} task={task} index={index} onClick={() => onTaskClick(task)} />
                                    ))}
                                    {provided.placeholder}
                                </div>
                            )}
                        </Droppable>
                    </div>
                )}


                {/* SECTIONS COLUMNS */}
                {sections.map(section => {
                    const sectionTasks = getTasksBySection(section.gid);

                    return (
                        <div key={section.gid} className="w-80 shrink-0 flex flex-col max-h-full h-full">
                            {/* Header */}
                            <div className="flex items-center justify-between mb-4 px-1 shrink-0">
                                <div className="flex items-center gap-2">
                                    <h3 className="font-bold text-slate-200 text-sm uppercase tracking-wider truncate max-w-[180px]" title={section.name}>{section.name}</h3>
                                    <Badge variant="secondary" className="bg-purple-500/20 text-purple-300 border-none hover:bg-purple-500/30 w-5 h-5 flex items-center justify-center p-0 text-[10px]">{sectionTasks.length}</Badge>
                                </div>
                                <Button onClick={() => onNewTask?.(section.gid)} variant="ghost" size="icon" className="h-6 w-6 text-slate-500 hover:text-white hover:bg-white/10">
                                    <Plus className="w-3.5 h-3.5" />
                                </Button>
                            </div>

                            {/* Droppable Area */}
                            <Droppable droppableId={section.gid}>
                                {(provided, snapshot) => (
                                    <div
                                        {...provided.droppableProps}
                                        ref={provided.innerRef}
                                        className={`bg-[#0f0f15] rounded-xl p-2 border transition-colors flex-1 overflow-y-auto no-scrollbar ${snapshot.isDraggingOver ? 'border-purple-500/50 bg-purple-500/5' : 'border-white/5'}`}
                                        style={{ minHeight: '200px' }}
                                    >
                                        <div className="space-y-2">
                                            {sectionTasks.map((task, index) => (
                                                <TaskCard key={task.gid} task={task} index={index} onClick={() => onTaskClick(task)} />
                                            ))}
                                            {provided.placeholder}
                                        </div>
                                    </div>
                                )}
                            </Droppable>
                        </div>
                    );
                })}
            </div>
        </DragDropContext>
    );
};

// Sub-component for individual card
const TaskCard = ({ task, index, onClick }: { task: AsanaTask, index: number, onClick: () => void }) => {
    return (
        <Draggable draggableId={task.gid} index={index}>
            {(provided, snapshot) => (
                <div
                    ref={provided.innerRef}
                    {...provided.draggableProps}
                    {...provided.dragHandleProps}
                    onClick={onClick}
                    className={`group relative bg-[#1e1e2e] hover:bg-[#252535] border border-white/5 rounded-lg p-3 shadow-sm transition-all cursor-grab active:cursor-grabbing hover:border-purple-500/30 ${snapshot.isDragging ? 'shadow-xl ring-2 ring-purple-500 rotate-2 z-50' : ''}`}
                    style={provided.draggableProps.style}
                >
                    <div className="flex items-start justify-between gap-2 mb-2">
                        <div className="flex-1 space-y-1">
                            <div className="flex flex-wrap gap-1 mb-1">
                                {task.projects?.slice(0, 1).map(p => (
                                    <span key={p.gid} className={`text-[9px] px-1.5 py-0.5 rounded-sm font-semibold uppercase tracking-wide opacity-80 ${getColorClass(p.color)}`}>
                                        {p.name}
                                    </span>
                                ))}
                            </div>
                            <h4 className={`text-sm font-medium leading-tight ${task.completed ? 'text-slate-500 line-through' : 'text-slate-200'}`}>
                                {task.name}
                            </h4>
                        </div>
                        {task.completed && <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />}
                    </div>

                    <div className="flex items-center justify-between mt-3 pt-3 border-t border-white/5">
                        <div className="flex items-center gap-3">
                            {task.assignee ? (
                                <Avatar className="h-5 w-5 ring-1 ring-white/10">
                                    <AvatarImage src={task.assignee.photo?.image_60x60 || undefined} />
                                    <AvatarFallback className="text-[9px] bg-slate-700">{task.assignee.name.charAt(0)}</AvatarFallback>
                                </Avatar>
                            ) : (
                                <div className="h-5 w-5 rounded-full border border-dashed border-slate-600 flex items-center justify-center">
                                    <UserIcon className="w-2.5 h-2.5 text-slate-600" />
                                </div>
                            )}

                            {task.due_on && (
                                <div className={`flex items-center text-[10px] font-medium gap-1 ${new Date(task.due_on) < new Date() && !task.completed ? 'text-red-400' : 'text-slate-500'}`}>
                                    <CalendarClock className="w-3 h-3" />
                                    {formatTaskDate(task)}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </Draggable>
    );
};
