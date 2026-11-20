export function normalize(value:string){
 return value.normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
}
const billedBefore=/(?:^|[|:;,(\[\/+&•·]|\s[-–—]|(?:^|\s)(?:e|y|and|with|com|feat\.?|ft\.?|x|vs\.?))\s*["'“‘]*\s*(?:(?:the|os|as|los|las)\s+)?$/u;
const billedAfter=/^["'”’]*(?:[!?.…]*\s*$|\s*[|:;,()\[\]\/+&@•·]|\s+[-–—](?:\s|$)|\s+(?:e|y|and|with|com|feat|ft|x|em|no|na|in|at|en|ao vivo|en vivo|live|in concert|em concerto|tour|turne|gira|shows?|20\d\d)(?![\p{L}\p{N}]))/u;
const tribute=/(?:^|[^\p{L}\p{N}])(?:tribut[\p{L}\p{N}]*|covers?|homenage[\p{L}\p{N}]*)(?![\p{L}\p{N}])/u;
/** A title bills the artist itself: "Artist", "Artist - Tour", "Other + Artist", "Artist ao vivo". The name inside a
 *  longer one ("Big Time Rush"), followed by other words ("Queen Experience") or beside a tribute is another event. */
export function namesArtist(title:string,artist:string){
 const name=normalize(artist),text=title.normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/\s+/g,' ');
 if(!name)return false;
 const pattern=new RegExp(`(^|[^\\p{L}\\p{N}])${name.split(' ').join('[^\\p{L}\\p{N}]+')}(?![\\p{L}\\p{N}])`,'gu');
 for(let match=pattern.exec(text);match;match=pattern.exec(text)){
  const start=match.index+match[1].length,before=text.slice(0,start),after=text.slice(match.index+match[0].length);
  if(tribute.test(before+' '+after))return false;
  if(billedBefore.test(before)&&billedAfter.test(after))return true;
 }
 return false;
}
