// Opt-in bounded reads; routes keep their existing no-query response contracts.
export function readPage(query, HttpError) {
  const page=Number(query.page??1),pageSize=Number(query.pageSize??50);
  if(!Number.isSafeInteger(page)||page<1||page>1_000_000||!Number.isSafeInteger(pageSize)||pageSize<1||pageSize>100)
    throw new HttpError(400,'Phân trang không hợp lệ.');
  return {page,pageSize,offset:(page-1)*pageSize};
}
