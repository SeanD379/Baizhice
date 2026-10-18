export function pdfTextLayout(items,viewport){
  const positioned=items.filter(item=>typeof item.str==='string'&&item.str.trim()).map(item=>({text:item.str,x:item.transform[4],y:item.transform[5],width:Math.abs(item.width??0),height:Math.abs(item.height||Math.hypot(item.transform[2],item.transform[3])||12)})).sort((a,b)=>b.y-a.y||a.x-b.x);
  const rows=[];
  for(const item of positioned){
    const row=rows.find(r=>Math.abs(r.y-item.y)<=Math.max(2,Math.min(r.height,item.height)*0.35));
    if(row)row.items.push(item);else rows.push({y:item.y,height:item.height,items:[item]});
  }
  const gaps=[];
  for(const row of rows){
    row.items.sort((a,b)=>a.x-b.x);
    for(let i=1;i<row.items.length;i++){
      const left=row.items[i-1],right=row.items[i],end=left.x+left.width;
      if(right.x-end>Math.max(24,row.height*3))gaps.push({start:end,end:right.x,cut:(end+right.x)/2});
    }
  }
  // A repeated gutter separates columns; a one-off word gap does not.
  let gutter=gaps.find(gap=>gaps.filter(other=>other.start<gap.cut&&other.end>gap.cut).length>=2);
  // Independent columns need not share baselines; nearby horizontal bands also
  // supply gutter evidence when each side has multiple lines in the same area.
  if(!gutter){
    const bands=positioned.filter(item=>item.width<viewport.width/2).sort((a,b)=>a.x-b.x);
    let end=bands[0]?.x??0;
    for(const item of bands){
      if(item.x-end>Math.max(24,item.height*3)){
        const cut=(end+item.x)/2,l=bands.filter(part=>part.x+part.width<cut),r=bands.filter(part=>part.x>cut);
        const overlapping=l.length>=2&&r.length>=2&&Math.max(...l.map(part=>part.y))>=Math.min(...r.map(part=>part.y))&&Math.max(...r.map(part=>part.y))>=Math.min(...l.map(part=>part.y));
        if(overlapping){gutter={start:end,end:item.x,cut};break;}
      }
      end=Math.max(end,item.x+item.width);
    }
  }
  const makeLine=parts=>{
    let text='';
    parts.forEach((item,i)=>{const previous=parts[i-1];if(previous&&item.x-previous.x-previous.width>item.height*0.15&&!/\s$/.test(text)&&!/^\s/.test(item.text))text+=' ';text+=item.text;});
    const x=Math.min(...parts.map(p=>p.x)),right=Math.max(...parts.map(p=>p.x+p.width)),y=Math.min(...parts.map(p=>p.y)),height=Math.max(...parts.map(p=>p.height));
    return {text:text.trim(),bbox:{x,y,width:right-x,height}};
  };
  const lines=[],left=[],right=[];
  const flush=()=>{lines.push(...left,...right);left.length=0;right.length=0;};
  for(const row of rows){
    if(!gutter){lines.push(makeLine(row.items));continue;}
    if(row.items.some(item=>item.x<gutter.cut&&item.x+item.width>gutter.cut)){flush();lines.push(makeLine(row.items));continue;}
    const l=row.items.filter(item=>item.x<gutter.cut),r=row.items.filter(item=>item.x>=gutter.cut);
    if(l.length)left.push(makeLine(l));if(r.length)right.push(makeLine(r));
  }
  flush();
  return {text:lines.map(line=>line.text).join('\n'),layout:{width:viewport.width,height:viewport.height,coordinateSystem:'pdf-bottom-left',lines}};
}
