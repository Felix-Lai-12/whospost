const profiles={standard:{id:'standard',posts:10,replies:50,replyScope:'other_threads',postsCapUsd:.10,repliesCapUsd:.20},'acceptance-30-100':{id:'acceptance-30-100',posts:30,postsFetch:60,replies:100,replyScope:'all_authored',postsCapUsd:.15,repliesCapUsd:.25}};
export function collectionProfile(id='standard'){if(typeof id!=='string'||!Object.hasOwn(profiles,id))throw Error('Unknown collection profile');return {...profiles[id]};}
export function scanCollectionProfile(scan){return collectionProfile(scan.collectionRequest?.id??'standard');}
export function coversProfile(scan,requested){const stored=scanCollectionProfile(scan);return stored.posts>=requested.posts&&stored.replies>=requested.replies&&(stored.replyScope===requested.replyScope||stored.replyScope==='all_authored');}
