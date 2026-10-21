export const sourceMetadataFields=['sourceDocument','sourceRevision','sourceSection','sourceLocation'] as const;
export type SourceMetadataField=typeof sourceMetadataFields[number];
export type SourceMetadata=Record<SourceMetadataField,string|null>;
export type SourceMetadataPatch=Partial<Record<SourceMetadataField,string>>;

export function mergeSourceMetadata(current:SourceMetadata,patch:SourceMetadataPatch,overwriteExisting:boolean){
  const updated:SourceMetadataPatch={};
  const unchanged:SourceMetadataField[]=[];
  const protectedFields:SourceMetadataField[]=[];
  for(const field of sourceMetadataFields){
    const next=patch[field];if(next===undefined)continue;
    const previous=current[field]?.trim()||'';
    if(previous===next.trim()){unchanged.push(field);continue;}
    if(previous&&!overwriteExisting){protectedFields.push(field);continue;}
    updated[field]=next.trim();
  }
  return{updated,unchanged,protectedFields};
}
