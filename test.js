



const getCarsData = async()=>{
  const res = await fetch("https://web.gw.coches.net/vehicle-specs/v1/body-types/form?section1Id=2500&makeId=69&modelId=97", {
"headers": {
  "accept": "*/*",
  "accept-language": "es-419,es;q=0.9",
  "cache-control": "no-cache",
  "pragma": "no-cache",
  "priority": "u=1, i",
  "sec-ch-ua": "\"Not-A.Brand\";v=\"24\", \"Chromium\";v=\"146\"",
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-platform": "\"macOS\"",
  "sec-fetch-dest": "empty",
  "sec-fetch-mode": "cors",
  "sec-fetch-site": "same-site",
  "x-schibsted-tenant": "coches"
},
"referrer": "https://www.coches.net/",
"body": null,
"method": "GET",
"mode": "cors",
"credentials": "include"
});
const data= await res.json()

  return data;
}

const run = async()=>{
    const data = await getCarsData()
    console.table(data)
}

run()