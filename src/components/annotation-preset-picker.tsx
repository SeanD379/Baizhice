'use client';
import { useId } from 'react';
import { studyPresets, type StudyPreset } from '@/lib/material-study';

export function annotationPreset(instruction:string):StudyPreset|undefined {
  return (Object.keys(studyPresets) as StudyPreset[]).find(id=>studyPresets[id].description===instruction);
}

export function AnnotationPresetPicker({instruction,onChange,disabled=false,autoFocus=false}:{instruction:string;onChange:(instruction:string)=>void;disabled?:boolean;autoFocus?:boolean}) {
  const name=useId(),selected=annotationPreset(instruction);
  return <fieldset className="annotation-preset-picker" aria-label="选择批注预设" disabled={disabled}>
    <legend>希望如何整理</legend>
    <div>{(Object.keys(studyPresets) as StudyPreset[]).map((id,index)=><label key={id} className={selected===id?'is-selected':''}>
      <input type="radio" name={name} value={id} checked={selected===id} autoFocus={autoFocus&&(selected===id||!selected&&index===0)} onChange={()=>onChange(studyPresets[id].description)}/>
      <span>{studyPresets[id].label}</span>
    </label>)}</div>
    {selected&&<p>{studyPresets[selected].description}</p>}
  </fieldset>;
}
