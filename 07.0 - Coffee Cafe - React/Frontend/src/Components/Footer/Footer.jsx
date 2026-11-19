import React, { Component } from 'react';
import {FaFacebook,FaInstagram,FaLinkedin } from "react-icons/fa6"
import FooterImg from '../../assets/website/coffee-footer.jpg';
const footerLinks=[
    {
        title:"Home",
        link:'/#'
    },
    {
        title:"About",
        link:'#about'
     },
    {
        title:"Contact Us",
        link:'#Contact'
    },
    {
        title:"Blog",
        link:'#blog'
    }
                            
]
const footerImgStyle={
    backgroundImage:`url(${FooterImg})`,
    backgroundSize:'cover',
    backgroundPosition:'center',
    backgroundRepeat:"no-repeat",
    minHeight: "300px",
    width:"100%"

}
const companyDetails={
    name:'Coffe Cafe',
    about:'Crafted Coffee, Cozy Vibes, Unforgetable Moments - Your Perfect Ecape to a Coffee Dream Land.',
    address:'123 Main St, Anytown, USA',
    phone:'+9715236421',
    email:'info@something.com',
}
const siteLink ={
    link:'https://github.com/eyasbzour/public_projects',
    linkText:'check out my git page'

}
class Footer extends Component{

  

    render(){
        return(
            <div className='text-white' style={footerImgStyle}>
                <div className="bg-black/40 min-h-[300px] py-8 px-4">
                    <div className='container grid md:grid-cols-3 pb-20 pt-5 space-x-3 space-y-6'>
                        {/* company details */}
                        <div className='grid-cols-1 col-span-1 space-y-4'>
                            <a href='#' className='font-semibold text-xl tracking-widest sm:text-3xl font-cursive hover:shadow-inner'>
                                {companyDetails.name}
                                </a>
                            <p className=''>
                                {" "}
                                {companyDetails.about}
                            </p>
                            <a
                                href={siteLink.link}
                                target='_blank'
                                className='inline-block bg-[#3d2517] px-4 py-2 mt-5 text-sm rounded-full hover:scale-x-105 transition duration-300 ease-in-out'
                            >
                                {siteLink.linkText}
                            </a>
                        </div>
                        {/* footer links */}
                        <div className='grid grid-cols-2 col-span-2 sm:grid-cols-3 sd:col-span-3'>
                            {/* first col links */}
                            <div className=''>
                                <h1 className='text-xl font-semibold sm-text-left mb-3'>
                                    Footer links
                                </h1>
                                <ul className='space-y-3'>
                                {footerLinks.map((footerLink,index)=>{
                                    return(
                                        <li key={index}>
                                            <a href={footerLink.link} className='inline-block hover:scale-x-105 hover:drop-shadow-md 
                                             transition duration-300 ease-in-out'>{footerLink.title}</a>    
                                        </li>
                                    )
                                })}
                                </ul>
                            </div>
                            {/* second col links */}
                            <div className=''>
                                <h1 className='text-xl font-semibold sm-text-left mb-3'>
                                    Quick links
                                </h1>
                                <ul className='space-y-3'>
                                {footerLinks.map((footerLink,index)=>{
                                    return(
                                        <li key={index}>
                                            <a href={footerLink.link} className='inline-block hover:scale-x-105 hover:drop-shadow-md 
                                             transition duration-300 ease-in-out'>{footerLink.title}</a>    
                                        </li>
                                    )
                                })}
                                </ul>
                            </div>
                            {/* company address section */}
                            <div className='space-y-3'>
                                <h1 className='text-xl font-semibold sm:ext-left mb-3'>Address</h1>
                                <div className='space-y-3'>
                                    <p className='text-sm'>{companyDetails.address}</p>
                                    {companyDetails.phone!==''?<p className='text-sm'>{companyDetails.phone}</p>:''}
                                    {companyDetails.email!==''?<p className='text-sm'>{companyDetails.email}</p>:''}
                                </div>
                                <div className='social-media-links space-x-3'>
                                    <a href='#'>
                                        <FaFacebook className='inline-block text-2xl hover:scale-110 transition duration-300 ease-in-out'/>
                                    </a>
                                    <a href='#'>
                                        <FaInstagram className='inline-block text-2xl hover:scale-110 transition duration-300 ease-in-out'/>
                                    </a>
                                    <a href='#'>
                                        <FaLinkedin className='inline-block text-2xl hover:scale-110 transition duration-300 ease-in-out'/>
                                    </a>                                    
                                </div>
                            </div>
                        </div>

                    </div>
                </div>
            </div>

        )
    }
}


export default Footer;